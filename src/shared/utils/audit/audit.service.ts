import { Prisma } from '@prisma/client';
import { logger } from '../logger/logger';
import { canonicalizeAuditValue, computeAuditHash, GENESIS_PREV_HASH } from './auditHash.util';
import { retryableTransaction, isRetryableWriteConflict } from '../db/withWriteConflictRetry';

export interface AuditLogParams {
  organizationId: string;
  userId?: string;
  action: string;
  entity: string;
  entityId: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
}

interface AuditLogRecord {
  signature_hash: string;
}

/**
 * Service d'audit implémentant le principe WORM (Write Once Read Many).
 * Chaque log est chaîné au précédent via un hash (Blockchain-like simple)
 * pour garantir l'intégrité de la piste d'audit (Objectif 7).
 */
export const auditService = {
  /**
   * Enregistre une action dans la table Audit_Log avec chaînage de hash.
   *
   * L'écriture DOIT vivre dans une transaction : la lecture du dernier maillon et l'insertion
   * du suivant forment un tout indivisible. Si l'appelant fournit sa `tx`, on l'y greffe (même
   * atomicité que l'opération métier) ; sinon on ouvre une transaction dédiée, rejouée sur
   * conflit. L'intégrité de la chaîne repose sur l'index unique `(organization_id, prev_hash)`
   * (fork impossible) + le retry (une écriture perdante relit l'état frais et ré-enchaîne).
   */
  async logAction(params: AuditLogParams, tx?: Prisma.TransactionClient) {
    if (tx) {
      return this.writeChainedLog(params, tx);
    }
    return retryableTransaction((t) => this.writeChainedLog(params, t));
  },

  /** Écrit un maillon chaîné. À appeler dans une transaction (voir `logAction`). */
  async writeChainedLog(params: AuditLogParams, db: Prisma.TransactionClient) {
    try {
      const lastLogs = await db.$queryRaw<AuditLogRecord[]>(
        Prisma.sql`SELECT signature_hash FROM "Audit_Log" WHERE organization_id = ${params.organizationId} ORDER BY id DESC LIMIT 1`
      );
      const lastLog = lastLogs.length > 0 ? lastLogs[0] : null;

      const prevHash = lastLog ? lastLog.signature_hash : GENESIS_PREV_HASH;

      // Source unique pour le hash ET la persistence — garantit la recompute exacte
      const horodatage = new Date();

      // Normalisation `?? null` : Postgres persiste `undefined` comme `NULL`, et la
      // relecture retourne `null`. Sans normalisation à l'écriture, le hash calculé
      // côté write (avec `undefined` qui drop dans JSON.stringify) divergerait du
      // recompute côté verify (qui voit `null` depuis Postgres). Verrouillage du
      // contrat avant persistence.
      // Canonicalisé ICI, une fois, parce que c'est exactement cette valeur qui sera hachée ET
      // persistée. Sans ça, la symétrie reposait sur l'hypothèse que Prisma sérialise dans `jsonb`
      // comme `JSON.stringify` — c'est faux pour `Prisma.Decimal`, stocké en NOMBRE là où
      // `JSON.stringify` produit une CHAÎNE (mesuré contre PostgreSQL réel). Voir #294.
      const oldValueNormalized = canonicalizeAuditValue(params.oldValue ?? null) as Record<
        string,
        unknown
      > | null;
      const newValueNormalized = canonicalizeAuditValue(params.newValue ?? null) as Record<
        string,
        unknown
      > | null;

      const signatureHash = computeAuditHash({
        organizationId: params.organizationId,
        userId: params.userId,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        oldValue: oldValueNormalized,
        newValue: newValueNormalized,
        prevHash,
        timestamp: horodatage.toISOString(),
      });

      // Persist les MÊMES valeurs que celles hashées — verrouille l'invariant
      // "hash inputs === stored values" (sans ça, un futur changement du hash mais
      // pas du create pourrait à nouveau diverger).
      const log = await db.audit_Log.create({
        data: {
          organization_id: params.organizationId,
          id_user: params.userId,
          action: params.action,
          entity: params.entity,
          entity_id: params.entityId,
          ancienne_valeur: oldValueNormalized as Prisma.InputJsonValue,
          nouvelle_valeur: newValueNormalized as Prisma.InputJsonValue,
          prev_hash: prevHash,
          signature_hash: signatureHash,
          horodatage,
        },
      });

      return log;
    } catch (error) {
      // Un conflit d'écriture (fork rattrapé par l'index unique, sérialisation) est le chemin
      // NOMINAL sous concurrence : retryableTransaction va le rejouer. On ne le logge donc pas en
      // erreur, sinon une rafale d'écritures réussies noierait le journal de fausses erreurs.
      if (!isRetryableWriteConflict(error)) {
        logger.error(`[AuditService] Erreur lors de l'enregistrement de l'audit: ${error}`);
      }
      throw error;
    }
  },
};
