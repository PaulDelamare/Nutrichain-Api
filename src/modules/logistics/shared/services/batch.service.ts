import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../../shared/utils/audit/audit.service';
import { BATCH_STATUSES, BatchStatus } from '../../constants/logistics.constants';

export interface CreateBatchInput {
  organization_id: string;
  id_produit: string;
  quantite_actuelle: number;
  unite_code: string;
  created_by: string;
  date_peremption?: Date;
  /** Statut initial du lot. Défaut EN_STOCK ; BLOQUE pour une réception non-conforme. */
  statut?: BatchStatus;
}

/**
 * Service partagé pour la gestion des Lots (Batches).
 * Centralise la logique de création et de gestion des stocks.
 */
export const batchService = {
  /**
   * Crée un nouveau lot (Batch) dans le système.
   * Doit être appelé à l'intérieur d'une transaction Prisma pour garantir l'atomicité.
   */
  async createBatch(tx: Prisma.TransactionClient, data: CreateBatchInput) {
    return tx.batch.create({
      data: {
        organization_id: data.organization_id,
        id_produit: data.id_produit,
        quantite_actuelle: data.quantite_actuelle,
        quantite_base: data.quantite_actuelle, // Initialement, base = actuelle
        unite_code: data.unite_code,
        created_by: data.created_by,
        date_peremption: data.date_peremption,
        statut: data.statut ?? BATCH_STATUSES.IN_STOCK,
      },
    });
  },

  /**
   * Récupère un lot par son ID avec isolation multi-tenant.
   */
  async getBatchById(id: string, activeOrgId: string) {
    const batch = await prisma.batch.findFirst({
      where: {
        id,
        organization_id: activeOrgId,
      },
      include: {
        produit: true,
        unite: true,
      },
    });

    if (!batch) {
      throw new APIError(404, {
        error: [{ field: 'batch', message: 'Lot introuvable dans cette organisation' }],
      });
    }

    return batch;
  },

  /**
   * Lève la quarantaine d'un lot (BLOQUE -> EN_STOCK) suite à une décision qualité.
   * Action HACCP délibérée : tracée dans l'audit WORM avec le motif. Seul un lot
   * réellement en quarantaine peut être levé (refus 409 sinon) — on ne « débloque »
   * pas un lot sous rappel/alerte par ce canal.
   */
  async liftQuarantine(id: string, activeOrgId: string, userId: string, motif: string) {
    return prisma.$transaction(
      async (tx) => {
        const batch = await tx.batch.findFirst({
          where: { id, organization_id: activeOrgId },
        });

        if (!batch) {
          throw new APIError(404, {
            error: [{ field: 'batch', message: 'Lot introuvable dans cette organisation' }],
          });
        }

        if (batch.statut !== BATCH_STATUSES.BLOCKED) {
          throw new APIError(409, {
            error: [
              {
                field: 'statut',
                message: `Seul un lot en quarantaine (BLOQUE) peut être levé. Statut actuel : ${batch.statut}.`,
              },
            ],
          });
        }

        const updated = await tx.batch.update({
          where: { id },
          data: {
            statut: BATCH_STATUSES.IN_STOCK,
            version: { increment: 1 },
          },
        });

        await auditService.logAction(
          {
            organizationId: activeOrgId,
            userId,
            action: 'LIFT_BATCH_QUARANTINE',
            entity: 'Batch',
            entityId: id,
            oldValue: { statut: batch.statut },
            newValue: { statut: BATCH_STATUSES.IN_STOCK, motif },
          },
          tx
        );

        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  },
};
