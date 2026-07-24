import { Prisma } from '@prisma/client';
import { receiptService } from '../../logistics/receipts/services/receipt.service';
import { auditService } from '../../../shared/utils/audit/audit.service';
import { retryableTransaction } from '../../../shared/utils/db/withWriteConflictRetry';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { logger } from '../../../shared/utils/logger/logger';
import {
  idempotencyService,
  IDEMPOTENCY_TTL_MS,
} from '../../../shared/utils/idempotency/idempotency.service';
import { resolveWritingActor } from '../../../shared/utils/auth/resolveWritingActor';
import { SyncItem, SyncItemError, SyncItemResult, SyncScansResponse } from '../types/sync.types';

export interface SyncScansParams {
  items: SyncItem[];
  organizationId: string;
  sessionUserId?: string;
  actorUserId?: string;
}

export const syncScansService = {
  /**
   * Orchestre le bulk sync mobile. Chaque item est traité dans sa propre transaction
   * atomique (idempotency claim + receipt + audit) ; une erreur sur un item ne casse
   * pas les autres (réponse 207 multi-status côté controller).
   */
  async syncScans(params: SyncScansParams): Promise<SyncScansResponse> {
    const userId = await resolveAndAuthorize(params);

    const results: SyncItemResult[] = [];
    for (const item of params.items) {
      results.push(await processItem(item, params.organizationId, userId));
    }

    return { results, summary: buildSummary(results) };
  },
};

/**
 * Résout l'identité de l'acteur. Même règle que la réception directe : une seule source de vérité
 * pour « qui a le droit de signer une écriture » (cf. shared/utils/auth/resolveWritingActor).
 */
function resolveAndAuthorize(params: SyncScansParams): string {
  return resolveWritingActor({ sessionUserId: params.sessionUserId });
}

/**
 * Traite un item dans une transaction atomique :
 *  1. claim idempotency (findUnique) — replay / conflict / first-write
 *  2. crée placeholder IdempotencyKey
 *  3. délégue receiptService.createReceipt avec le même tx
 *  4. met à jour IdempotencyKey avec la réponse finale
 *  5. audit WORM
 * Si une étape échoue, la transaction rollback intégralement (rien de partiel persiste).
 */
async function processItem(
  item: SyncItem,
  organizationId: string,
  userId: string
): Promise<SyncItemResult> {
  try {
    const result = await retryableTransaction(
      async (tx) => {
        const requestHash = idempotencyService.hashPayload(item.payload);

        // 1. Idempotency claim (replay / conflict / first-write) — dans la même tx atomique.
        const claim = await idempotencyService.claim(tx, {
          organizationId,
          clientOpId: item.clientOpId,
          userId,
          requestHash,
          ttlMs: IDEMPOTENCY_TTL_MS,
        });
        if (claim.replay) {
          return claim.payload as SyncItemResult;
        }

        // 2. Op métier dans la même tx
        const created = await runOperation(item, organizationId, userId, tx);

        const okResult: SyncItemResult = {
          clientOpId: item.clientOpId,
          status: 'ok',
          serverId: created,
        };

        // 3. Finalise la clé d'idempotency avec la réponse mise en cache.
        await idempotencyService.finalize(tx, {
          organizationId,
          clientOpId: item.clientOpId,
          payload: okResult,
        });

        // 5. Audit WORM (action distincte pour distinguer du flow non-bulk)
        await auditService.logAction(
          {
            organizationId,
            userId,
            action: 'CREATE_RECEIPT_VIA_SYNC',
            entity: 'Receipt',
            entityId: created.receiptId,
            newValue: { batchId: created.batchId, clientOpId: item.clientOpId },
          },
          tx
        );

        return okResult;
      },
      {
        timeout: 30000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );

    return result;
  } catch (err) {
    return toErrorResult(item.clientOpId, err);
  }
}

/**
 * Dispatch d'une opération sync vers le service métier correspondant.
 * L'assertion `never` garantit qu'ajouter un nouveau type cassera la compilation
 * tant qu'on n'a pas câblé son handler.
 */
async function runOperation(
  item: SyncItem,
  organizationId: string,
  userId: string,
  tx: Prisma.TransactionClient
): Promise<{ receiptId: string; batchId: string }> {
  switch (item.type) {
    case 'receipt': {
      const result = await receiptService.createReceipt(
        {
          organization_id: organizationId,
          id_fournisseur: item.payload.id_fournisseur,
          shipment_id: item.payload.shipment_id,
          id_produit: item.payload.id_produit,
          quantite_actuelle: item.payload.quantite_actuelle,
          unite_code: item.payload.unite_code,
          statut_controle: item.payload.statut_controle,
          id_materiel: item.payload.id_materiel, // emplacement de stockage (scan mobile)
          lot_number: item.payload.lot_number, // numéro lu sur l'étiquette du fournisseur (AI 10)
          date_peremption: item.payload.date_peremption, // DLC lue sur l'étiquette (AI 17)
          received_by: userId, // forcé serveur-side (anti-usurpation)
        },
        tx
      );
      return { receiptId: result.receiptId, batchId: result.batchId };
    }
    default: {
      const _exhaustive: never = item.type;
      throw new APIError(400, {
        error: [
          { field: 'type', message: `Type d'opération non supporté: ${String(_exhaustive)}` },
        ],
      });
    }
  }
}

function toErrorResult(clientOpId: string, err: unknown): SyncItemResult {
  if (err instanceof APIError) {
    const detail = err.body.error[0];
    const error: SyncItemError = { field: detail.field, message: detail.message };
    const status: 'error' | 'conflict' = err.status === 409 ? 'conflict' : 'error';
    return { clientOpId, status, error };
  }

  // Erreur non-métier (Prisma, réseau, etc.) : log brut côté serveur, message générique côté client
  // pour éviter de leak des détails techniques (stack, connection strings, etc.).
  const rawMessage = err instanceof Error ? err.message : String(err);
  logger.error(`[SyncScans] Erreur interne sur item ${clientOpId}: ${rawMessage}`);
  return {
    clientOpId,
    status: 'error',
    error: { field: 'internal', message: 'Erreur interne du serveur' },
  };
}

function buildSummary(results: SyncItemResult[]) {
  const summary = { total: results.length, ok: 0, error: 0, conflict: 0 };
  for (const r of results) {
    summary[r.status] += 1;
  }
  return summary;
}
