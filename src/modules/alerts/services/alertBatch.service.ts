import { Alert, Prisma } from '@prisma/client';
import {
  QualityVerdict,
  readQualityCondemnation,
} from '../../logistics/shared/utils/qualityCondemnation';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { BATCH_STATUSES, MOVEMENT_TYPES } from '../../logistics/constants/logistics.constants';
import { COLD_CHAIN_ALERT_TYPE } from '../constants/alert.constants';

/**
 * Les lots d'une alerte froid — c'est-à-dire les lots que CETTE alerte retient EN CE MOMENT.
 *
 * ⚠️ Ce service existe parce que l'application n'avait aucun moyen de répondre à cette question.
 * Le mobile (et le front) reconstituaient la liste en filtrant `GET /organization/quarantine-batches`
 * — qui renvoie TOUS les lots `BLOQUE` de l'organisation — sur l'équipement de l'alerte. Or un frigo
 * contient aussi des lots bloqués pour de tout autres raisons. « Lever la quarantaine » remettait
 * donc en stock un lot bloqué par un contrôle qualité (corps étranger, DLC) que l'opérateur n'avait
 * jamais examiné : un RELÂCHEMENT NON CONSENTI.
 *
 * La liaison lot↔alerte existait pourtant déjà en base : `iotAlertService` écrit `metadata.id_alerte`
 * sur chaque mouvement `QUARANTAINE_FROID`. Personne ne la lisait.
 */
export interface AlertBatch {
  id: string;
  lot_number: string;
  /** Sérialisé en `string` par `JSON.stringify` (Decimal.js a un `toJSON`) — le client reçoit "12.5". */
  quantite_actuelle: Prisma.Decimal;
  unite_code: string;
  produit: { nom: string } | null;
  /** Vrai si la levée de CETTE alerte peut le remettre en stock. */
  levable: boolean;
  /** Renseigné quand `levable` est faux : pourquoi ce lot doit rester isolé. */
  motif_blocage: 'CONTROLE_NON_CONFORME' | null;
}

/**
 * Les mouvements qui font, ou défont, l'isolement FROID d'un lot. Le reste ne nous apprend rien —
 * la condamnation qualité, elle, se lit sur les contrôles eux-mêmes et non sur leur trace.
 */
const BLOCKING_MOVEMENTS = [MOVEMENT_TYPES.COLD_QUARANTINE, MOVEMENT_TYPES.QUARANTINE_LIFTED];

interface Movement {
  id: number;
  id_lot: string;
  type_action: string;
  metadata: Prisma.JsonValue;
}

/** Lecture sûre d'une clé de `metadata` (Json nullable, jamais typé par Prisma). */
function metaString(metadata: Prisma.JsonValue, key: string): string | null {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Prisma.JsonObject)[key];
  return typeof value === 'string' ? value : null;
}

export const alertBatchService = {
  /**
   * Les lots que cette alerte retient ENCORE — jamais les autres lots du même équipement.
   *
   * ⚠️ On ne demande PAS « ce lot a-t-il un jour été isolé par cette alerte ». Cette question croise
   * un fait HISTORIQUE (le mouvement a eu lieu) avec un fait PRÉSENT (le lot est bloqué maintenant),
   * sans vérifier que le blocage actuel est bien celui-là. Un lot isolé par l'alerte A, relâché, puis
   * ré-isolé par une excursion suivante B serait alors listé sous A : rouvrir la vieille alerte A
   * relâcherait le lot que B retient, frigo toujours en panne. Ce serait le même relâchement non
   * consenti, simplement déplacé de l'espace (le frigo) vers le temps.
   *
   * On regarde donc l'isolement EN VIGUEUR : le dernier `QUARANTAINE_FROID` du lot doit être celui de
   * cette alerte, et aucune levée ne doit l'avoir suivi.
   *
   * L'ordre se lit sur `Batch_Mouvement.id` (auto-incrémenté), pas sur `created_at` : deux mouvements
   * écrits dans la même transaction portent le MÊME horodatage (`now()` = début de transaction), et
   * un `>` sur les dates laisserait alors passer une non-conformité simultanée.
   *
   * Un lot est `levable` s'il ne porte aucun contrôle qualité NON CONFORME postérieur à son isolement.
   * Ce cas n'est pas théorique : `nextStatus` (qualityControl.service) laisse un lot déjà `BLOQUE`
   * inchangé quand le contrôle est non conforme — mais il ÉCRIT le mouvement. Le lot est alors isolé
   * par le froid ET déclaré impropre : réparer la chambre froide ne le rend pas consommable.
   */
  async listBatchesIsolatedByAlert(alert: Alert): Promise<AlertBatch[]> {
    // ⚠️ Un rappel produit crée aussi une `Alert`, mais il bloque sa descendance en `ALERTE` via des
    // mouvements `RAPPEL` — jamais `QUARANTAINE_FROID`. Répondre « 0 lot » à un rappel serait un
    // mensonge silencieux sur l'alerte la plus grave du système : on ne confond pas « il n'y en a
    // pas » avec « la question n'a pas de sens ici ».
    if (alert.type !== COLD_CHAIN_ALERT_TYPE) {
      throw new APIError(409, {
        error: [
          {
            field: 'alert',
            message: `La notion de lot isolé n'est définie que pour une excursion thermique (${COLD_CHAIN_ALERT_TYPE}). Cette alerte est de type ${alert.type} : ses lots impactés se consultent via le workflow correspondant.`,
          },
        ],
      });
    }

    // Les lots que cette alerte a isolés un jour, et qui sont encore bloqués aujourd'hui. C'est un
    // ensemble de CANDIDATS : il reste à vérifier que le blocage actuel est bien celui de l'alerte.
    const candidates = await prisma.batch_Mouvement.findMany({
      where: {
        type_action: MOVEMENT_TYPES.COLD_QUARANTINE,
        metadata: { path: ['id_alerte'], equals: alert.id },
        lot: {
          organization_id: alert.organization_id,
          statut: BATCH_STATUSES.BLOCKED,
        },
      },
      select: {
        id_lot: true,
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
    });

    if (candidates.length === 0) return [];

    const movements: Movement[] = await prisma.batch_Mouvement.findMany({
      where: {
        id_lot: { in: candidates.map((c) => c.id_lot) },
        type_action: { in: BLOCKING_MOVEMENTS },
      },
      select: { id: true, id_lot: true, type_action: true, metadata: true },
      orderBy: { id: 'asc' },
    });

    // Les verdicts qualité des lots candidats, en UNE requête. L'écran doit annoncer « levable »
    // avec la même lecture que les services de levée : la déduire des mouvements laissait un lot
    // marqué « non levable » à jamais, même après la contre-analyse qui le libère.
    const verdicts = await prisma.qualityControl.findMany({
      where: { id_lot: { in: candidates.map((c) => c.id_lot) } },
      select: { id: true, id_lot: true, resultat: true, id_user_labo: true, date_test: true },
      orderBy: [{ date_test: 'asc' }, { id: 'asc' }],
    });

    const verdictsByBatch = new Map<string, QualityVerdict[]>();
    for (const verdict of verdicts) {
      const list = verdictsByBatch.get(verdict.id_lot) ?? [];
      list.push(verdict);
      verdictsByBatch.set(verdict.id_lot, list);
    }

    const batches: AlertBatch[] = [];

    for (const candidate of candidates) {
      const history = movements.filter((m) => m.id_lot === candidate.id_lot);

      // L'isolement EN VIGUEUR : le dernier `QUARANTAINE_FROID` du lot.
      const isolation = history
        .filter((m) => m.type_action === MOVEMENT_TYPES.COLD_QUARANTINE)
        .pop();

      // Ce n'est pas notre alerte qui le retient : une excursion PLUS RÉCENTE a repris la main.
      if (!isolation || metaString(isolation.metadata, 'id_alerte') !== alert.id) continue;

      // Cet isolement a été levé — si le lot est encore bloqué, c'est pour une AUTRE raison.
      const lifted = history.some(
        (m) => m.id > isolation.id && m.type_action === MOVEMENT_TYPES.QUARANTINE_LIFTED
      );
      if (lifted) continue;

      const condemnation = readQualityCondemnation(verdictsByBatch.get(candidate.id_lot) ?? []);
      const condemned = condemnation !== null && condemnation.counterAnalysis === null;

      batches.push({
        id: candidate.lot.id,
        lot_number: candidate.lot.lot_number,
        quantite_actuelle: candidate.lot.quantite_actuelle,
        unite_code: candidate.lot.unite_code,
        produit: candidate.lot.produit,
        levable: !condemned,
        motif_blocage: condemned ? 'CONTROLE_NON_CONFORME' : null,
      });
    }

    return batches;
  },
};
