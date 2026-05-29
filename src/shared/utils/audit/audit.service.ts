import { Prisma } from '@prisma/client';
import { logger } from '../logger/logger';
import { prisma as prismaClient } from '../../configs/prismaClient.config';
import { computeAuditHash, GENESIS_PREV_HASH } from './auditHash.util';

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
   * Supporte l'utilisation d'une transaction Prisma existante.
   */
  async logAction(params: AuditLogParams, tx?: Prisma.TransactionClient) {
    const db = tx || prismaClient;
    try {
      const lastLogs = await db.$queryRaw<AuditLogRecord[]>(
        Prisma.sql`SELECT signature_hash FROM "Audit_Log" WHERE organization_id = ${params.organizationId} ORDER BY id DESC LIMIT 1 FOR UPDATE`
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
      const oldValueNormalized = params.oldValue ?? null;
      const newValueNormalized = params.newValue ?? null;

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
      logger.error(`[AuditService] Erreur lors de l'enregistrement de l'audit: ${error}`);
      throw error;
    }
  },
};
