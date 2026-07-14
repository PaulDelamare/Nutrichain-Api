import { Alert, Prisma } from '@prisma/client';
import { prisma } from '../../../shared/configs/prismaClient.config';
import {
  BATCH_STATUSES,
  MOVEMENT_TYPES,
  QUALITY_RESULTS,
} from '../../logistics/constants/logistics.constants';

/**
 * Les lots d'une alerte froid — c'est-à-dire les lots que CETTE alerte a isolés.
 *
 * ⚠️ Ce service existe parce que l'application n'avait aucun moyen de répondre à cette question.
 * Le mobile (et le front) reconstituaient la liste en filtrant `GET /organization/quarantine-batches`
 * — qui renvoie TOUS les lots `BLOQUE` de l'organisation — sur l'équipement de l'alerte. Or un frigo
 * contient aussi des lots bloqués pour de tout autres raisons. « Lever la quarantaine » remettait
 * donc en stock un lot bloqué par un contrôle qualité (corps étranger, DLC) que l'opérateur n'avait
 * jamais examiné : un RELÂCHEMENT NON CONSENTI.
 *
 * La liaison lot↔alerte existait pourtant déjà en base : `iotAlertService` écrit
 * `metadata.id_alerte` sur chaque mouvement `QUARANTAINE_FROID`. Personne ne la lisait.
 */
export interface AlertBatch {
  id: string;
  lot_number: string;
  quantite_actuelle: Prisma.Decimal;
  unite_code: string;
  produit: { nom: string } | null;
  /** Vrai si la levée de CETTE alerte peut le remettre en stock. */
  levable: boolean;
  /** Renseigné quand `levable` est faux : pourquoi ce lot doit rester isolé. */
  motif_blocage: 'CONTROLE_NON_CONFORME' | null;
}

export const alertBatchService = {
  /**
   * Les lots isolés par cette alerte et ENCORE isolés — jamais les autres lots du même équipement.
   *
   * Un lot est `levable` s'il ne porte aucun contrôle qualité **NON CONFORME postérieur** à son
   * isolement. Ce cas n'est pas théorique : `nextStatus` (qualityControl.service) laisse un lot déjà
   * `BLOQUE` inchangé quand le contrôle est non conforme — mais il ÉCRIT le mouvement. Le lot est
   * alors isolé par le froid ET déclaré impropre. Le rendre au stock parce que la chambre froide est
   * réparée relâcherait une marchandise non conforme.
   *
   * « Postérieur » n'est pas une précaution de style : un lot a pu être bloqué par un contrôle, levé,
   * remis en stock, puis subir l'excursion. Sa non-conformité est alors ANCIENNE et déjà tranchée —
   * elle ne doit pas le condamner une seconde fois.
   */
  async listBatchesIsolatedByAlert(alert: Alert): Promise<AlertBatch[]> {
    const quarantines = await prisma.batch_Mouvement.findMany({
      where: {
        type_action: MOVEMENT_TYPES.COLD_QUARANTINE,
        metadata: { path: ['id_alerte'], equals: alert.id },
        // Le lot est encore isolé : un lot déjà relâché n'a plus rien à faire dans cette liste.
        // Le scope organisation est une défense en profondeur (l'alerte l'est déjà).
        lot: {
          organization_id: alert.organization_id,
          statut: BATCH_STATUSES.BLOCKED,
        },
      },
      select: {
        id_lot: true,
        created_at: true,
        lot: {
          select: {
            id: true,
            lot_number: true,
            quantite_actuelle: true,
            unite_code: true,
            produit: { select: { nom: true } },
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    if (quarantines.length === 0) return [];

    const nonConformities = await prisma.batch_Mouvement.findMany({
      where: {
        id_lot: { in: quarantines.map((q) => q.id_lot) },
        type_action: MOVEMENT_TYPES.QUALITY_CONTROL,
        metadata: { path: ['resultat'], equals: QUALITY_RESULTS.NON_CONFORM },
      },
      select: { id_lot: true, created_at: true },
    });

    return quarantines.map((q) => {
      const condemned = nonConformities.some(
        (nc) => nc.id_lot === q.id_lot && nc.created_at > q.created_at
      );

      return {
        id: q.lot.id,
        lot_number: q.lot.lot_number,
        quantite_actuelle: q.lot.quantite_actuelle,
        unite_code: q.lot.unite_code,
        produit: q.lot.produit,
        levable: !condemned,
        motif_blocage: condemned ? 'CONTROLE_NON_CONFORME' : null,
      };
    });
  },
};
