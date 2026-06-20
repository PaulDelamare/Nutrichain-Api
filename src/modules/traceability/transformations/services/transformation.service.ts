import { prisma } from '../../../../shared/configs/prismaClient.config';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { Batch, Prisma } from '@prisma/client';
import { auditService } from '../../../../shared/utils/audit/audit.service';

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
          note_technique: (data.note_technique || {}) as Prisma.InputJsonValue,
          horodatage_fin: new Date(),
        },
      });

      // 4. Création des compositions et mise à jour des parents
      // TRI DES INPUTS par ID pour éviter les DEADLOCKS (verrouillage dans le même ordre par tous les threads)
      const sortedInputs = [...data.inputs].sort((a, b) =>
        a.id_lot_parent.localeCompare(b.id_lot_parent)
      );

      for (const input of sortedInputs) {
        // RE-LECTURE DANS LA TRANSACTION pour garantir la version la plus fraîche (Optimistic Locking)
        const currentParent = await tx.batch.findUniqueOrThrow({
          where: { id: input.id_lot_parent, organization_id: data.organization_id },
        });

        // RE-VÉRIFICATION DU STATUT au moment du verrouillage (Sécurité Rappel de dernière seconde)
        if (currentParent.statut === 'ALERTE') {
          throw new APIError(400, {
            error: [
              {
                field: 'inputs',
                message: `Le lot parent ${input.id_lot_parent} vient d'être bloqué (ALERTE) et ne peut plus être transformé.`,
              },
            ],
          });
        }

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

        // Déduction du stock sur le parent avec Verrouillage Optimiste (version)
        // On utilise updateMany car Prisma update exige un identifiant unique (id seul)
        const isExhausted = input.lot_parent_epuise;

        const updateResult = await tx.batch.updateMany({
          where: {
            id: input.id_lot_parent,
            organization_id: data.organization_id,
            version: currentParent.version, // Utilisation de la version fraîche lue dans la tx
          },
          data: {
            quantite_actuelle: { decrement: input.quantite_prelevee },
            statut: isExhausted ? 'EPUISE' : 'EN_STOCK',
            version: { increment: 1 }, // Incrément de version à chaque mutation
          },
        });

        if (updateResult.count === 0) {
          throw new APIError(409, {
            error: [
              {
                field: 'inputs',
                message: `Conflit de modification sur le lot ${input.id_lot_parent} (Race Condition détectée). Veuillez réessayer.`,
              },
            ],
          });
        }

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

        const newQuantite = currentParent.quantite_actuelle
          .minus(input.quantite_prelevee)
          .toNumber();
        const newStatut = isExhausted ? 'EPUISE' : 'EN_STOCK';

        await auditService.logAction(
          {
            organizationId: data.organization_id,
            userId: data.created_by,
            action: 'TRANSFORM_CONSUME',
            entity: 'Batch',
            entityId: input.id_lot_parent,
            oldValue: {
              quantite: currentParent.quantite_actuelle.toNumber(),
              statut: currentParent.statut,
            },
            newValue: { quantite: newQuantite, statut: newStatut },
          },
          tx
        );
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

      // 6. ENREGISTREMENT EVENEMENT EPCIS GS1 (Interopérabilité Internationale)
      await tx.ePCIS_Event.create({
        data: {
          organization_id: data.organization_id,
          event_time: new Date(),
          event_type: 'TransformationEvent',
          related_entity: 'Transformation',
          related_id: transformation.id,
          payload: {
            transformationID: transformation.id,
            inputEPCList: data.inputs.map((i) => i.id_lot_parent),
            outputEPCList: [lotEnfant.id],
            bizStep: 'urn:epcglobal:cbv:bizstep:transforming',
            disposition: 'urn:epcglobal:cbv:disp:in_progress',
            readPoint: data.id_materiel,
          },
        },
      });

      // Audit WORM : Tracé de la création du lot enfant
      await auditService.logAction(
        {
          organizationId: data.organization_id,
          userId: data.created_by,
          action: 'TRANSFORM_CREATE',
          entity: 'Batch',
          entityId: lotEnfant.id,
          newValue: { produit: data.id_produit_fini, quantite: data.quantite_produite },
        },
        tx
      );

      return {
        transformation_id: transformation.id,
        lot_enfant_id: lotEnfant.id,
      };
    });
  },
};
