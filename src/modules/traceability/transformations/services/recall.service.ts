import { prisma } from '../../../../shared/configs/prismaClient.config';
import { genealogyService } from './genealogy.service';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { logger } from '../../../../shared/utils/logger/logger';
import { auditService } from '../../../../shared/utils/audit/audit.service';

export interface RecallResult {
  blockedBatchesCount: number;
  impactedBatchIds: string[];
}

export const recallService = {
  /**
   * Déclenche un rappel produit à partir d'un lot source.
   * Passe le lot source et TOUTE sa descendance en statut 'ALERTE'.
   */
  async triggerRecall(
    batchId: string,
    organizationId: string,
    userId: string,
    reason: string
  ): Promise<RecallResult> {
    return await prisma.$transaction(async (tx) => {
      // 1. Vérifier l'existence du lot source
      const sourceBatch = await tx.batch.findFirst({
        where: { id: batchId, organization_id: organizationId },
      });

      if (!sourceBatch) {
        throw new APIError(404, {
          error: [{ field: 'batchId', message: 'Lot source introuvable.' }],
        });
      }

      // 2. Récupérer toute la descendance en passant la transaction active (tx)
      const descendants = await genealogyService.getDownstream(batchId, organizationId, tx);
      const allImpactedIds = [batchId, ...descendants.map((b) => b.id)];

      // 3. Mise à jour massive des statuts et incrémentation de la version pour invalider les transactions en cours
      await tx.batch.updateMany({
        where: {
          id: { in: allImpactedIds },
          organization_id: organizationId,
        },
        data: {
          statut: 'ALERTE',
          version: { increment: 1 },
        },
      });

      // 4. Trace d'audit / Alerte système
      await tx.alert.create({
        data: {
          organization_id: organizationId,
          type: 'PRODUCT_RECALL',
          niveau_gravite: 'CRITIQUE',
          message: `RAPPEL DÉCLENCHÉ : ${reason}. Source: ${batchId}. Total lots impactés: ${allImpactedIds.length}`,
          related_entity: 'Batch',
          related_id: batchId,
        },
      });

      // 5. Audit WORM (Immuable) : Tracé légal du rappel
      await auditService.logAction(
        {
          organizationId: organizationId,
          userId: userId,
          action: 'BATCH_RECALL_TRIGGERED',
          entity: 'Batch',
          entityId: batchId,
          oldValue: { statut: sourceBatch.statut },
          newValue: {
            statut: 'ALERTE',
            reason,
            impactedCount: allImpactedIds.length,
            impactedIds: allImpactedIds,
          },
        },
        tx
      );

      logger.warn(
        `[RECALL] Rappel déclenché par ${userId} pour le lot ${batchId}. ${allImpactedIds.length} lots bloqués.`
      );

      return {
        blockedBatchesCount: allImpactedIds.length,
        impactedBatchIds: allImpactedIds,
      };
    });
  },
};
