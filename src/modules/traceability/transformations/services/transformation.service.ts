import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { Batch, Prisma } from '@prisma/client';
import { auditService } from '../../../../shared/utils/audit/audit.service';
import { retryableTransaction } from '../../../../shared/utils/db/withWriteConflictRetry';
import { gs1Utils } from '../../../../shared/utils/gs1/gs1.utils';
import { resolveGs1Prefix } from '../../../../shared/utils/gs1/gs1Prefix';
import {
  EPCIS_BIZSTEP,
  EPCIS_DISPOSITION,
  EPCIS_EVENT_TYPE,
  EPCIS_RELATED_ENTITY,
} from '../../../../shared/constants/epcis.constants';
import {
  BATCH_STATUSES,
  MOVEMENT_TYPES,
  isBatchBlocked,
} from '../../../logistics/constants/logistics.constants';
import {
  idempotencyService,
  IDEMPOTENCY_TTL_MS,
} from '../../../../shared/utils/idempotency/idempotency.service';

export interface TransformationInput {
  organization_id: string;
  id_produit_fini: string;
  id_materiel: string;
  quantite_produite: number;
  unite_code: string;
  date_peremption?: Date;
  note_technique?: Record<string, unknown>;
  created_by: string;
  /** Clé d'idempotence optionnelle : un rejeu renvoie le 1er résultat au lieu de re-transformer. */
  client_op_id?: string;
  inputs: Array<{
    id_lot_parent: string;
    quantite_prelevee: number;
    unite: string;
    lot_parent_epuise: boolean;
  }>;
}

interface TransformationResult {
  transformation_id: string;
  lot_enfant_id: string;
}

/**
 * Service pour la gestion des Transformations (Généalogie des lots)
 */
export const transformationService = {
  /**
   * Enregistre une transformation : consomme des lots parents et crée un lot enfant.
   * Gère la traçabilité descendante.
   */
  async createTransformation(data: TransformationInput): Promise<TransformationResult> {
    return await retryableTransaction(
      async (tx): Promise<TransformationResult> => {
        // Idempotence optionnelle : un rejeu (coupure réseau mobile) renvoie le résultat du premier
        // appel au lieu de re-prélever les lots parents. L'empreinte est NORMALISÉE — dates en ISO,
        // inputs triés — car hashPayload garde l'ordre des tableaux et aplatit les Date : sans ça,
        // un rejeu reconstruit dans un autre ordre serait vu comme un conflit à tort.
        if (data.client_op_id) {
          const fingerprint = {
            id_produit_fini: data.id_produit_fini,
            id_materiel: data.id_materiel,
            quantite_produite: data.quantite_produite,
            unite_code: data.unite_code,
            date_peremption: data.date_peremption?.toISOString() ?? null,
            inputs: [...data.inputs].sort((a, b) =>
              a.id_lot_parent.localeCompare(b.id_lot_parent)
            ),
          };
          const claim = await idempotencyService.claim(tx, {
            organizationId: data.organization_id,
            clientOpId: data.client_op_id,
            userId: data.created_by,
            requestHash: idempotencyService.hashPayload(fingerprint),
            ttlMs: IDEMPOTENCY_TTL_MS,
          });
          if (claim.replay) {
            return claim.payload as TransformationResult;
          }
        }

        const result = await runTransformation(tx, data);

        // Met en cache le résultat : un rejeu de la même clé le renverra sans re-transformer.
        if (data.client_op_id) {
          await idempotencyService.finalize(tx, {
            organizationId: data.organization_id,
            clientOpId: data.client_op_id,
            payload: result,
          });
        }

        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 }
    );
  },
};

/**
 * Le corps métier d'une transformation, exécuté dans la transaction. Extrait de
 * `createTransformation` pour que le claim d'idempotence l'enveloppe proprement.
 */
async function runTransformation(
  tx: Prisma.TransactionClient,
  data: TransformationInput
): Promise<TransformationResult> {
      // 0. Le produit fini doit appartenir à l'organisation (anti-référence cross-tenant,
      // symétrique aux contrôles fournisseur/client) — son GTIN sert aussi à l'URN LGTIN.
      const finishedProduct = await tx.product.findFirst({
        where: { id: data.id_produit_fini, organization_id: data.organization_id },
        select: { code_gtin: true, is_active: true },
      });
      if (!finishedProduct) {
        throw new APIError(404, {
          error: [
            { field: 'id_produit_fini', message: 'Produit fini introuvable ou accès refusé.' },
          ],
        });
      }
      if (!finishedProduct.is_active) {
        throw new APIError(409, {
          error: [
            {
              field: 'id_produit_fini',
              message: 'Ce produit est archivé : aucune nouvelle production.',
            },
          ],
        });
      }

      // 0 bis. La CUVE aussi — le contrôle manquait, et son absence ne salissait pas qu'une
      // référence : la quarantaine automatique sur excursion de température croise
      // `organization_id` ET `id_materiel_actuel`. Un lot fini rattaché au matériel d'une AUTRE
      // organisation n'est donc bloqué par personne — ni par la sienne (le matériel n'y est pas),
      // ni par l'autre (le lot n'y est pas). Il échappe définitivement au rappel.
      const equipment = await tx.equipment.findFirst({
        where: { id: data.id_materiel, organization_id: data.organization_id },
        select: { id: true },
      });
      if (!equipment) {
        throw new APIError(404, {
          error: [{ field: 'id_materiel', message: 'Matériel introuvable ou accès refusé.' }],
        });
      }

      const gs1Prefix = await resolveGs1Prefix(tx, data.organization_id);

      // 1. Validation des lots parents
      const parents: Array<Batch & { produit: { code_gtin: string } }> = [];
      for (const input of data.inputs) {
        const batch = await tx.batch.findFirst({
          where: {
            id: input.id_lot_parent,
            organization_id: data.organization_id,
          },
          include: { produit: { select: { code_gtin: true } } },
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
        if (isBatchBlocked(batch.statut)) {
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
      const childBatch = await tx.batch.create({
        data: {
          organization_id: data.organization_id,
          lot_number: gs1Utils.generateLotNumber(),
          id_produit: data.id_produit_fini,
          quantite_actuelle: data.quantite_produite,
          quantite_base: data.quantite_produite,
          unite_code: data.unite_code,
          date_peremption: data.date_peremption,
          id_materiel_actuel: data.id_materiel,
          created_by: data.created_by,
          // BARRIÈRE QUALITÉ : un produit fini ne sort pas de l'usine sans contrôle. Il naît en
          // attente, donc ni transformable ni expédiable, jusqu'à ce qu'un contrôle le libère.
          statut: BATCH_STATUSES.PENDING_QC,
        },
      });

      // 3. Création de l'entête de transformation
      const transformation = await tx.transformation.create({
        data: {
          id_lot_enfant: childBatch.id,
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

        // RE-VÉRIFICATION DU STATUT au moment du verrouillage (sécurité de dernière seconde).
        // ⚠️ Ce test comparait `=== 'ALERTE'` en dur : il laissait donc passer un lot mis en
        // QUARANTAINE entre-temps (excursion froid, contrôle non conforme). On teste la garde
        // sanitaire centrale, pas un statut particulier.
        if (isBatchBlocked(currentParent.statut)) {
          throw new APIError(400, {
            error: [
              {
                field: 'inputs',
                message: `Le lot parent ${input.id_lot_parent} vient d'être bloqué (${currentParent.statut}) et ne peut plus être transformé.`,
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
            // On NE réécrit PAS le statut du parent quand il reste du stock : le forcer à
            // EN_STOCK effacerait une quarantaine posée entre-temps, sans aucune trace.
            statut: isExhausted ? BATCH_STATUSES.DEPLETED : currentParent.statut,
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
            type_action: MOVEMENT_TYPES.TRANSFORMATION_OUT,
            quantite: input.quantite_prelevee,
            unite: input.unite,
            id_transformation: transformation.id,
            id_user: data.created_by,
          },
        });

        const newQuantity = currentParent.quantite_actuelle
          .minus(input.quantite_prelevee)
          .toNumber();
        const newStatus = isExhausted ? 'EPUISE' : 'EN_STOCK';

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
            newValue: { quantite: newQuantity, statut: newStatus },
          },
          tx
        );
      }

      // 5. Mouvement de stock pour le nouveau lot (Entrée par transformation)
      await tx.batch_Mouvement.create({
        data: {
          id_lot: childBatch.id,
          type_action: MOVEMENT_TYPES.TRANSFORMATION_IN,
          quantite: data.quantite_produite,
          unite: data.unite_code,
          id_transformation: transformation.id,
          id_user: data.created_by,
        },
      });

      // 6. Événement EPCIS TransformationEvent : lots identifiés au niveau classe
      // (URN LGTIN) dans les quantityList, comme à la réception et à l'expédition.
      await tx.ePCIS_Event.create({
        data: {
          organization_id: data.organization_id,
          event_time: new Date(),
          event_type: EPCIS_EVENT_TYPE.transformation,
          related_entity: EPCIS_RELATED_ENTITY.transformation,
          related_id: transformation.id,
          payload: {
            transformationID: transformation.id,
            inputQuantityList: data.inputs.map((input, index) => ({
              epcClass: gs1Utils.buildLgtinUrn(
                gs1Prefix,
                parents[index].produit.code_gtin,
                parents[index].lot_number
              ),
              quantity: input.quantite_prelevee,
              uom: input.unite,
            })),
            outputQuantityList: [
              {
                epcClass: gs1Utils.buildLgtinUrn(
                  gs1Prefix,
                  finishedProduct.code_gtin,
                  childBatch.lot_number
                ),
                quantity: data.quantite_produite,
                uom: data.unite_code,
              },
            ],
            bizStep: EPCIS_BIZSTEP.transforming,
            disposition: EPCIS_DISPOSITION.inProgress,
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
          entityId: childBatch.id,
          newValue: { produit: data.id_produit_fini, quantite: data.quantite_produite },
        },
        tx
      );

      return {
        transformation_id: transformation.id,
        lot_enfant_id: childBatch.id,
      };
}
