import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

export interface CreateBatchInput {
  organization_id: string;
  id_produit: string;
  quantite_actuelle: number;
  unite_code: string;
  created_by: string;
  date_peremption?: Date;
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
        statut: 'EN_STOCK',
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
};
