import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../../shared/utils/audit/audit.service';
import { gs1Utils } from '../../../../shared/utils/gs1/gs1.utils';
import { BATCH_STATUSES, BatchStatus, MOVEMENT_TYPES } from '../../constants/logistics.constants';

/** Plafond de l'historique renvoyé avec un lot (frise de la fiche lot). */
const BATCH_HISTORY_LIMIT = 50;

export interface CreateBatchInput {
  organization_id: string;
  id_produit: string;
  quantite_actuelle: number;
  unite_code: string;
  created_by: string;
  /**
   * Numéro imprimé sur l'étiquette du fournisseur (AI 10). Absent, le serveur en génère un.
   * Le garder est ce qui permet de RETROUVER le lot en le rescannant : sans lui, la même palette
   * rescannée est un lot inconnu, et l'opérateur la réceptionne une seconde fois.
   */
  lot_number?: string;
  date_peremption?: Date;
  /** Statut initial du lot. Défaut EN_STOCK ; BLOQUE pour une réception non-conforme. */
  statut?: BatchStatus;
  /** Emplacement de stockage du lot (matériel) — permet de connaître sa position. */
  id_materiel_actuel?: string;
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
        lot_number: data.lot_number ?? gs1Utils.generateLotNumber(),
        id_produit: data.id_produit,
        quantite_actuelle: data.quantite_actuelle,
        quantite_base: data.quantite_actuelle, // Initialement, base = actuelle
        unite_code: data.unite_code,
        created_by: data.created_by,
        date_peremption: data.date_peremption,
        statut: data.statut ?? BATCH_STATUSES.IN_STOCK,
        id_materiel_actuel: data.id_materiel_actuel,
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
        // Emplacement réel et auteur : affichés par la fiche lot, ils n'étaient pas servis.
        materiel: { include: { lieu: true } },
        user: { select: { id: true, name: true, email: true } },
        // L'historique du lot. Borné : un lot très mouvementé ne doit pas faire exploser
        // la réponse. Les plus récents d'abord.
        mouvements: {
          take: BATCH_HISTORY_LIMIT,
          orderBy: { created_at: 'desc' },
          include: { user: { select: { name: true } } },
        },
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

        // La décision qualité entre dans l'historique du lot. `quantite` porte ici la quantité
        // concernée par la décision, pas un mouvement de matière (cf. MOVEMENT_TYPES).
        await tx.batch_Mouvement.create({
          data: {
            id_lot: id,
            type_action: MOVEMENT_TYPES.QUARANTINE_LIFTED,
            quantite: batch.quantite_actuelle,
            unite: batch.unite_code,
            id_user: userId,
            metadata: { motif, statut_precedent: batch.statut },
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
