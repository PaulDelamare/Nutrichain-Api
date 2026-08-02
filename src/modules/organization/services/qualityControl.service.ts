import { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../shared/utils/audit/audit.service';
import { retryableTransaction } from '../../../shared/utils/db/withWriteConflictRetry';
import {
  enforceSeparationOfDuties,
  SELF_RELEASE_TRACE,
} from '../../logistics/shared/utils/separationOfDuties';
import {
  BATCH_STATUSES,
  MOVEMENT_TYPES,
  QUALITY_RESULTS,
  QualityResult,
} from '../../logistics/constants/logistics.constants';

export interface CreateQualityControlInput {
  organization_id: string;
  id_lot: string;
  type_test: string;
  resultat: QualityResult;
  notes?: string;
  certificat_pdf?: string;
  /** Résolu depuis la session — jamais depuis le corps de la requête. */
  id_user_labo: string;
}

/**
 * Statut du lot APRÈS un contrôle. C'est la table d'états, et elle est volontairement stricte.
 *
 * ⚠️ Un contrôle qualité n'est PAS une porte de sortie universelle :
 * - un lot sous RAPPEL (`ALERTE`) est irréversible. Aucun contrôle ne le libère, et aucun ne le
 *   rétrograde en `BLOQUE` (qui, lui, est levable) : ce serait deux clics pour sortir un lot rappelé.
 * - un contrôle ne libère QUE ce qu'il est censé libérer : un lot qui attend son contrôle de sortie.
 * - sur un lot déjà en stock, le contrôle est enregistré (traçabilité) mais ne change rien ; s'il est
 *   NON CONFORME, il place le lot en quarantaine — c'est le seul cas où il durcit le statut.
 */
function nextStatus(current: string, resultat: QualityResult): string | null {
  if (current === BATCH_STATUSES.ALERT) {
    throw new APIError(409, {
      error: [
        {
          field: 'id_lot',
          message:
            'Ce lot est sous rappel produit : la décision est irréversible. Un contrôle qualité ne peut pas le libérer.',
        },
      ],
    });
  }

  if (resultat === QUALITY_RESULTS.NON_CONFORM) {
    // Non conforme : quarantaine, quel que soit l'état de départ (sauf ALERTE, déjà refusé).
    return current === BATCH_STATUSES.BLOCKED ? null : BATCH_STATUSES.BLOCKED;
  }

  // Conforme : ne libère QUE le lot qui attendait son contrôle de sortie.
  if (current === BATCH_STATUSES.PENDING_QC) {
    return BATCH_STATUSES.IN_STOCK;
  }

  // Contre-analyse d'un lot en quarantaine : elle s'ENREGISTRE sans rien libérer. C'est la preuve
  // que la levée exigera — refuser sa saisie, comme avant, rendait la levée impossible à justifier,
  // et condamnait donc définitivement un lot déclaré non conforme par erreur.
  if (current === BATCH_STATUSES.BLOCKED) {
    return null;
  }

  // EN_STOCK, EXPEDIE, EPUISE… : le contrôle est enregistré, le statut ne bouge pas.
  return null;
}

export const qualityControlService = {
  /**
   * Saisit un contrôle qualité et applique sa conséquence sur le lot, ATOMIQUEMENT.
   * Le contrôle et le statut du lot ne peuvent pas diverger.
   */
  async createQualityControl(data: CreateQualityControlInput) {
    return retryableTransaction(
      async (tx) => {
        // Cloisonnement : le lot doit appartenir à l'organisation de l'appelant.
        const batch = await tx.batch.findFirst({
          where: { id: data.id_lot, organization_id: data.organization_id },
        });

        if (!batch) {
          throw new APIError(404, {
            error: [{ field: 'id_lot', message: 'Lot introuvable dans cette organisation' }],
          });
        }

        const target = nextStatus(batch.statut, data.resultat);

        // La garde ne porte que sur la LIBÉRATION : déclarer son propre lot non conforme reste
        // permis, et doit le rester (cf. `enforceSeparationOfDuties`).
        const selfSigned =
          target === BATCH_STATUSES.IN_STOCK &&
          (await enforceSeparationOfDuties(tx, {
            organizationId: data.organization_id,
            batchCreatedBy: batch.created_by,
            actorUserId: data.id_user_labo,
            field: 'id_lot',
          }));

        const control = await tx.qualityControl.create({
          data: {
            organization_id: data.organization_id,
            id_lot: data.id_lot,
            type_test: data.type_test,
            resultat: data.resultat,
            notes: data.notes,
            certificat_pdf: data.certificat_pdf,
            id_user_labo: data.id_user_labo,
            date_test: new Date(),
          },
        });

        if (target) {
          const updated = await tx.batch.updateMany({
            where: {
              id: data.id_lot,
              organization_id: data.organization_id,
              // Verrou optimiste : si le lot a changé d'état entre-temps (rappel, excursion
              // froid…), on refuse plutôt que d'écraser une décision plus récente.
              version: batch.version,
            },
            data: {
              statut: target,
              // Mémorise l'état d'AVANT la quarantaine, comme le fait déjà l'alerte froid. Sans
              // lui, la levée qualité ne sait pas où rendre le lot : un produit fini qui attendait
              // son contrôle de sortie repartirait EN_STOCK, donc expédiable sans avoir jamais
              // franchi la barrière HACCP. Effacé à la levée.
              ...(target === BATCH_STATUSES.BLOCKED ? { statut_avant_blocage: batch.statut } : {}),
              version: { increment: 1 },
            },
          });

          if (updated.count === 0) {
            throw new APIError(409, {
              error: [
                {
                  field: 'id_lot',
                  message:
                    'Le statut du lot a changé pendant la saisie du contrôle. Rechargez la fiche du lot et vérifiez son état avant de conclure.',
                },
              ],
            });
          }
        }

        await tx.batch_Mouvement.create({
          data: {
            id_lot: data.id_lot,
            type_action: MOVEMENT_TYPES.QUALITY_CONTROL,
            quantite: batch.quantite_actuelle,
            unite: batch.unite_code,
            id_user: data.id_user_labo,
            metadata: {
              resultat: data.resultat,
              type_test: data.type_test,
              statut_precedent: batch.statut,
              statut_resultant: target ?? batch.statut,
            },
          },
        });

        await auditService.logAction(
          {
            organizationId: data.organization_id,
            userId: data.id_user_labo,
            action: 'CREATE_QUALITY_CONTROL',
            entity: 'Batch',
            entityId: data.id_lot,
            oldValue: { statut: batch.statut },
            newValue: {
              statut: target ?? batch.statut,
              resultat: data.resultat,
              type_test: data.type_test,
              ...(selfSigned ? { separation_des_taches: SELF_RELEASE_TRACE } : {}),
            },
          },
          tx
        );

        return { control, statut_lot: target ?? batch.statut };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  },

  /** Lots qui attendent leur contrôle de sortie d'usine. Sans cette liste, ils sont invisibles. */
  async listPendingQualityControl(activeOrgId: string) {
    return prisma.batch.findMany({
      where: { organization_id: activeOrgId, statut: BATCH_STATUSES.PENDING_QC },
      select: {
        id: true,
        lot_number: true,
        quantite_actuelle: true,
        unite_code: true,
        date_creation: true,
        produit: { select: { nom: true } },
      },
      orderBy: { date_creation: 'asc' },
    });
  },
};
