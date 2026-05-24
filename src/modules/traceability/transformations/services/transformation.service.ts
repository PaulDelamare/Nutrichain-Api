import { prisma } from '../../../../shared/configs/prismaClient.config';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { Batch } from '@prisma/client';

export interface TransformationInput {
  organization_id: string;
  id_produit_fini: string;
  id_materiel: string;
  quantite_produite: number;
  unite_code: string;
  date_peremption?: Date;
  note_technique?: Record<string, unknown>;
  created_by: string;
  inputs: Array<{
    id_lot_parent: string;
    quantite_prelevee: number;
    unite: string;
    lot_parent_epuise: boolean;
  }>;
}

/**
 * Service pour la gestion des Transformations (Généalogie des lots)
 */
export const transformationService = {
  /**
   * Enregistre une transformation : consomme des lots parents et crée un lot enfant.
   * Gère la traçabilité descendante.
   */
  async createTransformation(data: TransformationInput) {
    return await prisma.$transaction(async (tx) => {
      // 1. Validation des lots parents
      const parents: Batch[] = [];
      for (const input of data.inputs) {
        const batch = await tx.batch.findFirst({
          where: {
            id: input.id_lot_parent,
            organization_id: data.organization_id,
          },
        });

        if (!batch) {
          throw new APIError(404, {
            error: [
              {
                field: 'inputs',
                message: `Lot parent ${input.id_lot_parent} introuvable ou accès refusé.`,
              },
            ],
          });
        }

        if (batch.quantite_actuelle.toNumber() < input.quantite_prelevee) {
          throw new APIError(400, {
            error: [
              {
                field: 'inputs',
                message: `Stock insuffisant pour le lot parent ${batch.id}.`,
              },
            ],
          });
        }

        // 1.b Validation Qualité et Péremption
        if (['NON_CONFORME', 'ALERTE'].includes(batch.statut)) {
          throw new APIError(400, {
            error: [
              {
                field: 'inputs',
                message: `Le lot parent ${batch.id} est en statut ${batch.statut} et ne peut pas être transformé.`,
              },
            ],
          });
        }

        if (batch.date_peremption && new Date(batch.date_peremption) < new Date()) {
          throw new APIError(400, {
            error: [
              {
                field: 'inputs',
                message: `Le lot parent ${batch.id} est périmé.`,
              },
            ],
          });
        }

        parents.push(batch);
      }

      // 2. Création du lot enfant (Produit Fini)
      const lotEnfant = await tx.batch.create({
        data: {
          organization_id: data.organization_id,
          id_produit: data.id_produit_fini,
          quantite_actuelle: data.quantite_produite,
          quantite_base: data.quantite_produite,
          unite_code: data.unite_code,
          date_peremption: data.date_peremption,
          id_materiel_actuel: data.id_materiel,
          created_by: data.created_by,
          statut: 'EN_STOCK',
        },
      });

      // 3. Création de l'entête de transformation
      const transformation = await tx.transformation.create({
        data: {
          id_lot_enfant: lotEnfant.id,
          id_produit_fini: data.id_produit_fini,
          id_user: data.created_by,
          id_materiel: data.id_materiel,
          statut: 'TERMINE',
          note_technique: data.note_technique || {},
          horodatage_fin: new Date(),
        },
      });

      // 4. Création des compositions et mise à jour des parents
      for (const input of data.inputs) {
        // Enregistrement du lien de généalogie
        await tx.transformationComposition.create({
          data: {
            id_transformation: transformation.id,
            id_lot_parent: input.id_lot_parent,
            quantite_prelevee: input.quantite_prelevee,
            unite: input.unite,
            lot_parent_epuise: input.lot_parent_epuise,
          },
        });

        // Déduction du stock sur le parent
        const isExhausted = input.lot_parent_epuise;
        await tx.batch.update({
          where: { id: input.id_lot_parent },
          data: {
            quantite_actuelle: { decrement: input.quantite_prelevee },
            statut: isExhausted ? 'EPUISE' : 'EN_STOCK',
          },
        });

        // Mouvement de stock (Sortie pour transformation)
        await tx.batch_Mouvement.create({
          data: {
            id_lot: input.id_lot_parent,
            type_action: 'TRANSFORMATION_SORTIE',
            quantite: input.quantite_prelevee,
            unite: input.unite,
            id_transformation: transformation.id,
            id_user: data.created_by,
          },
        });
      }

      // 5. Mouvement de stock pour le nouveau lot (Entrée par transformation)
      await tx.batch_Mouvement.create({
        data: {
          id_lot: lotEnfant.id,
          type_action: 'TRANSFORMATION_ENTREE',
          quantite: data.quantite_produite,
          unite: data.unite_code,
          id_transformation: transformation.id,
          id_user: data.created_by,
        },
      });

      return {
        transformation_id: transformation.id,
        lot_enfant_id: lotEnfant.id,
      };
    });
  },
};
