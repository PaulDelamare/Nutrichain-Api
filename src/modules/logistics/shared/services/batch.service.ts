import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../../shared/utils/audit/audit.service';
import { retryableTransaction } from '../../../../shared/utils/db/withWriteConflictRetry';
import { gs1Utils } from '../../../../shared/utils/gs1/gs1.utils';
import { enforceSeparationOfDuties, SELF_RELEASE_TRACE } from '../utils/separationOfDuties';
import {
  BATCH_STATUSES,
  BatchStatus,
  MOVABLE_BATCH_STATUSES,
  MOVEMENT_TYPES,
  QUALITY_RESULTS,
} from '../../constants/logistics.constants';
import { STORAGE_EQUIPMENT_TYPES } from '../../../organization/middlewares/equipment.schema';

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
  /** Réception d'origine, pour les lots de matière première. Absent pour un produit fini. */
  id_receipt?: string;
}

/**
 * La fiche d'un lot, servie à l'identique qu'on l'ouvre par son id ou en scannant son étiquette :
 * le client affiche le même écran dans les deux cas.
 *
 * Le `where` EXIGE l'organisation dans son type, pas dans un commentaire : Prisma ignore purement
 * et simplement un `organization_id: undefined`, donc un appelant distrait ne filtrerait plus rien
 * — et scanner l'étiquette d'un concurrent ouvrirait la fiche de son lot.
 */
async function findBatchOr404(
  where: Prisma.BatchWhereInput & { organization_id: string },
  revealAuthor: boolean
) {
  const batch = await prisma.batch.findFirst({
    where,
    include: {
      produit: true,
      unite: true,
      materiel: { include: { lieu: true } },
      // Le nom et l'e-mail de l'auteur sont une donnée PERSONNELLE : un opérateur ou un viewer qui
      // consulte un lot n'a pas à savoir qui l'a créé (cf. PERSONAL_DATA_ROLES). La liste des lots
      // et le journal d'audit appliquent déjà cette règle ; la fiche, elle, était restée ouverte.
      ...(revealAuthor ? { user: { select: { id: true, name: true, email: true } } } : {}),
      // L'historique du lot. Borné : un lot très mouvementé ne doit pas faire exploser
      // la réponse. Les plus récents d'abord.
      mouvements: {
        take: BATCH_HISTORY_LIMIT,
        orderBy: { created_at: 'desc' },
        ...(revealAuthor ? { include: { user: { select: { name: true } } } } : {}),
      },
    },
  });

  if (!batch) {
    throw new APIError(404, {
      error: [{ field: 'batch', message: 'Lot introuvable dans cette organisation' }],
    });
  }

  return batch;
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
        id_receipt: data.id_receipt,
      },
    });
  },

  /**
   * Récupère un lot par son ID avec isolation multi-tenant.
   */
  async getBatchById(id: string, activeOrgId: string, revealAuthor = false) {
    return findBatchOr404({ id, organization_id: activeOrgId }, revealAuthor);
  },

  /**
   * Résout le lot qu'on vient de scanner, à partir du numéro porté par son étiquette (GS1 AI 10).
   *
   * Sans ça, un client ne peut identifier un lot qu'en listant le catalogue et en cherchant
   * lui-même — or `GET /traceability/batches` est plafonné à 100 lots : passé ce seuil, un lot bien
   * réel est déclaré « inconnu », et l'opérateur réceptionne une seconde fois une palette déjà en
   * stock. La résolution appartient donc au serveur, qui seul voit tous les lots.
   */
  async resolveBatchByLotNumber(lotNumber: string, activeOrgId: string, revealAuthor = false) {
    return findBatchOr404(
      {
        organization_id: activeOrgId,
        // Égalité EXACTE sur le numéro mis en majuscules, comme il est écrit (cf. createBatch).
        // Un `mode: 'insensitive'` serait plus tolérant en apparence, mais il écarte l'index
        // `@@unique([organization_id, lot_number])` — donc un balayage à chaque scan — et, la
        // contrainte d'unicité étant sensible à la casse, `abc123` et `ABC123` pourraient coexister :
        // un `findFirst` sans tri en aurait alors renvoyé un AU HASARD. Le scanner aurait ouvert la
        // fiche du mauvais lot.
        lot_number: lotNumber.toUpperCase(),
      },
      revealAuthor
    );
  },

  /**
   * Lève la quarantaine d'un lot (BLOQUE -> EN_STOCK) suite à une décision qualité.
   * Action HACCP délibérée : tracée dans l'audit WORM avec le motif. Seul un lot
   * réellement en quarantaine peut être levé (refus 409 sinon) — on ne « débloque »
   * pas un lot sous rappel/alerte par ce canal.
   */
  async liftQuarantine(id: string, activeOrgId: string, userId: string, motif: string) {
    return retryableTransaction(
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

        // La levée de quarantaine ne traite QUE l'incident froid. Si le dernier verdict qualité du
        // lot est « non conforme », il ne se libère pas par ce canal : réparer la chambre froide ne
        // rend pas consommable un produit contaminé. La garde vaut pour tout lot BLOQUE condamné,
        // qu'il ait ou non subi une excursion — un contrôle non conforme laisse le lot BLOQUE
        // (nextStatus, qualityControl.service) et un tel lot n'a, à ce stade du modèle, pas d'autre
        // issue que le rebut : on refuse de le remettre en circulation, on ne promet pas de retour.
        // Tiebreak par `id` : à date_test égale, l'ordre reste déterministe.
        const dernierControle = await tx.qualityControl.findFirst({
          where: { id_lot: id, organization_id: activeOrgId },
          orderBy: [{ date_test: 'desc' }, { id: 'desc' }],
          select: { resultat: true },
        });

        if (dernierControle?.resultat === QUALITY_RESULTS.NON_CONFORM) {
          throw new APIError(409, {
            error: [
              {
                field: 'statut',
                message:
                  'Ce lot a échoué un contrôle qualité : il ne se libère pas par la levée de quarantaine froid.',
              },
            ],
          });
        }

        const autoSignee = await enforceSeparationOfDuties(tx, {
          organizationId: activeOrgId,
          batchCreatedBy: batch.created_by,
          actorUserId: userId,
          field: 'batch',
        });

        // On revient au statut d'AVANT la quarantaine froid : un produit fini qui attendait son
        // contrôle de sortie (EN_ATTENTE_QC) y retourne, il ne devient pas expédiable. Faute de
        // statut mémorisé (lot né BLOQUE à une réception non conforme), on retombe sur EN_STOCK.
        const statutRestaure = batch.statut_avant_blocage ?? BATCH_STATUSES.IN_STOCK;

        const updated = await tx.batch.update({
          where: { id },
          data: {
            statut: statutRestaure,
            statut_avant_blocage: null,
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
            metadata: { motif, statut_precedent: batch.statut, statut_resultant: statutRestaure },
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
            newValue: {
              statut: statutRestaure,
              motif,
              ...(autoSignee ? { separation_des_taches: SELF_RELEASE_TRACE } : {}),
            },
          },
          tx
        );

        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  },

  /**
   * Déplace un lot vers un autre emplacement de stockage. Corrige un angle mort sanitaire : la
   * quarantaine froid cible les lots par `id_materiel_actuel` — une position figée à la création
   * rendait la surveillance fausse dès le premier déplacement réel (faux négatifs ET faux positifs).
   *
   * Seul un lot LIBRE bouge (cf. MOVABLE_BATCH_STATUSES) : un lot en quarantaine ou sous rappel est
   * immobilisé. Le matériel cible doit être un emplacement de STOCKAGE (pas une cuve/mixeur). Tracé
   * dans l'audit WORM, comme toute écriture à conséquence sanitaire.
   */
  async moveBatch(id: string, activeOrgId: string, userId: string, idMateriel: string) {
    return retryableTransaction(
      async (tx) => {
        const batch = await tx.batch.findFirst({
          where: { id, organization_id: activeOrgId },
        });

        if (!batch) {
          throw new APIError(404, {
            error: [{ field: 'batch', message: 'Lot introuvable dans cette organisation' }],
          });
        }

        // Idempotent : le lot est déjà là. Un retry réseau d'un déplacement réussi ne doit pas
        // renvoyer une erreur ni ré-écrire un mouvement fantôme — on renvoie l'état, sans rien faire.
        if (batch.id_materiel_actuel === idMateriel) {
          return batch;
        }

        if (!(MOVABLE_BATCH_STATUSES as readonly string[]).includes(batch.statut)) {
          throw new APIError(409, {
            error: [
              {
                field: 'statut',
                message: `Un lot dans l'état ${batch.statut} ne peut pas être déplacé. Seul un lot disponible (EN_STOCK ou EN_ATTENTE_QC) se range ailleurs.`,
              },
            ],
          });
        }

        const materiel = await tx.equipment.findFirst({
          where: { id: idMateriel, organization_id: activeOrgId },
        });

        if (!materiel) {
          throw new APIError(404, {
            error: [{ field: 'id_materiel', message: 'Matériel introuvable dans cette organisation' }],
          });
        }

        if (!(STORAGE_EQUIPMENT_TYPES as readonly string[]).includes(materiel.type)) {
          throw new APIError(400, {
            error: [
              {
                field: 'id_materiel',
                message: `Un lot se range dans un emplacement de stockage (frigo, congélateur, étagère), pas dans un équipement de type ${materiel.type}.`,
              },
            ],
          });
        }

        // Verrou optimiste : la version lue est dans le where. Si une excursion froid concurrente a
        // fait passer le lot BLOQUE entre-temps, l'écriture ne mord pas (count 0) → 409, on ne
        // déplace pas un lot dont l'état a changé sous nos yeux.
        const updated = await tx.batch.updateMany({
          where: { id, organization_id: activeOrgId, version: batch.version },
          data: { id_materiel_actuel: idMateriel, version: { increment: 1 } },
        });

        if (updated.count === 0) {
          throw new APIError(409, {
            error: [
              {
                field: 'statut',
                message:
                  "L'état du lot a changé pendant le déplacement. Rechargez sa fiche avant de réessayer.",
              },
            ],
          });
        }

        // `quantite`/`unite` portent la quantité concernée par le geste, pas un mouvement de matière.
        await tx.batch_Mouvement.create({
          data: {
            id_lot: id,
            type_action: MOVEMENT_TYPES.MOVE,
            quantite: batch.quantite_actuelle,
            unite: batch.unite_code,
            id_user: userId,
            metadata: { from: batch.id_materiel_actuel, to: idMateriel },
          },
        });

        await auditService.logAction(
          {
            organizationId: activeOrgId,
            userId,
            action: 'MOVE_BATCH',
            entity: 'Batch',
            entityId: id,
            oldValue: { id_materiel_actuel: batch.id_materiel_actuel },
            newValue: { id_materiel_actuel: idMateriel },
          },
          tx
        );

        return tx.batch.findFirst({ where: { id, organization_id: activeOrgId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  },
};
