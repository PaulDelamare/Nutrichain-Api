import { PrismaClient, Prisma } from '@prisma/client';
import crypto from 'crypto';
import { logger } from '../logger/logger';

const prismaClient = new PrismaClient();

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
      // 1. Récupérer le dernier log de l'ORGANISATION avec un verrou
      const lastLogs = await db.$queryRaw<AuditLogRecord[]>(
        Prisma.sql`SELECT signature_hash FROM "Audit_Log" WHERE organization_id = ${params.organizationId} ORDER BY id DESC LIMIT 1 FOR UPDATE`
      );
      const lastLog = lastLogs.length > 0 ? lastLogs[0] : null;

      const prevHash = lastLog
        ? lastLog.signature_hash
        : '0000000000000000000000000000000000000000000000000000000000000000';

      // 2. Préparer les données pour le hash (incluant l'organizationId, prevHash et un timestamp précis pour l'unicité)
      const dataToHash = JSON.stringify({
        organizationId: params.organizationId,
        userId: params.userId || 'system',
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        oldValue: params.oldValue,
        newValue: params.newValue,
        prevHash: prevHash,
        timestamp: new Date().toISOString(),
      });

      // 3. Calculer le signature_hash
      const signatureHash = crypto.createHash('sha256').update(dataToHash).digest('hex');

      // 4. Créer l'entrée
      const log = await db.audit_Log.create({
        data: {
          organization_id: params.organizationId,
          id_user: params.userId,
          action: params.action,
          entity: params.entity,
          entity_id: params.entityId,
          ancienne_valeur: params.oldValue as Prisma.InputJsonValue,
          nouvelle_valeur: params.newValue as Prisma.InputJsonValue,
          prev_hash: prevHash,
          signature_hash: signatureHash,
        },
      });

      return log;
    } catch (error) {
      logger.error(`[AuditService] Erreur lors de l'enregistrement de l'audit: ${error}`);
      throw error;
    }
  },
};
