import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { APIError } from '../errorHandler/APIError';

/**
 * Mécanisme d'idempotence PARTAGÉ (bulk sync mobile ET transformation) — transverse, donc dans
 * `shared/` : les modules ne s'importent pas entre eux.
 *
 * `claim`/`finalize` PRENNENT la transaction (`tx`) de l'appelant : ils s'exécutent dans la même
 * unité atomique que l'opération métier (claim + écriture + audit). C'est cette signature `(tx, …)`
 * — comme `auditService.logAction(payload, tx)` — qui permet de factoriser sans rompre l'atomicité.
 * Deux appelants partagent une seule implémentation au lieu de la dupliquer inline.
 */

/** Durée de vie d'une clé d'idempotence : 7 jours. Compromis robustesse du retry mobile / volume DB. */
export const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface IdempotencyClaimParams {
  organizationId: string;
  clientOpId: string;
  userId: string;
  requestHash: string;
  ttlMs: number;
}

export type IdempotencyClaimResult = { replay: true; payload: unknown } | { replay: false };

export const idempotencyService = {
  /**
   * Calcule un SHA256 hex stable d'un payload, après normalisation par tri récursif des clés :
   * { a:1, b:2 } et { b:2, a:1 } produisent le même hash.
   * ⚠️ L'ordre des TABLEAUX est significatif (cf. test) et les `Date` s'aplatissent en `{}` :
   * l'appelant doit normaliser son empreinte (dates en ISO, tableaux triés) avant de la hasher.
   */
  hashPayload(payload: unknown): string {
    const canonical = canonicalStringify(payload);
    return crypto.createHash('sha256').update(canonical).digest('hex');
  },

  /**
   * Réserve (ou rejoue) une clé d'idempotence dans la transaction fournie.
   * - clé absente → place un placeholder `pending`, retourne `{ replay: false }`.
   * - clé présente, même hash → `{ replay: true, payload }` (le résultat mis en cache au 1er appel).
   * - clé présente, hash DIFFÉRENT → 409 : le client a rejoué la même clé avec un autre contenu.
   */
  async claim(
    tx: Prisma.TransactionClient,
    p: IdempotencyClaimParams
  ): Promise<IdempotencyClaimResult> {
    const compoundKey = { organization_id: p.organizationId, client_op_id: p.clientOpId };
    const existing = await tx.idempotencyKey.findUnique({
      where: { organization_id_client_op_id: compoundKey },
    });

    if (existing) {
      if (existing.request_hash !== p.requestHash) {
        throw new APIError(409, {
          error: [{ field: 'clientOpId', message: 'Idempotency conflict — payload diverged' }],
        });
      }
      return { replay: true, payload: existing.response_payload };
    }

    const now = new Date();
    await tx.idempotencyKey.create({
      data: {
        organization_id: p.organizationId,
        client_op_id: p.clientOpId,
        user_id: p.userId,
        request_hash: p.requestHash,
        response_status: 'pending',
        response_payload: {} as Prisma.InputJsonValue,
        created_at: now,
        expires_at: new Date(now.getTime() + p.ttlMs),
      },
    });
    return { replay: false };
  },

  /** Passe la clé en `ok` et met en cache le payload de réponse (rejoué aux appels suivants). */
  async finalize(
    tx: Prisma.TransactionClient,
    p: { organizationId: string; clientOpId: string; payload: unknown }
  ): Promise<void> {
    await tx.idempotencyKey.update({
      where: {
        organization_id_client_op_id: {
          organization_id: p.organizationId,
          client_op_id: p.clientOpId,
        },
      },
      data: {
        response_status: 'ok',
        response_payload: p.payload as Prisma.InputJsonValue,
      },
    });
  },
};

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(obj[k])).join(',') + '}'
  );
}
