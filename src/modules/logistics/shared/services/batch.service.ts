import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../../shared/utils/audit/audit.service';
import { retryableTransaction } from '../../../../shared/utils/db/withWriteConflictRetry';
import { gs1Utils } from '../../../../shared/utils/gs1/gs1.utils';
import { enforceSeparationOfDuties, SELF_RELEASE_TRACE } from '../utils/separationOfDuties';
import { loadQualityVerdicts, readQualityCondemnation } from '../utils/qualityCondemnation';
import { COLD_CHAIN_ALERT_TYPE } from '../../../alerts/constants/alert.constants';
import { reconcileLogisticUnitContent } from '../utils/reconcileLogisticUnitContent';
import {
  BATCH_STATUSES,
  BatchStatus,
  MOVABLE_BATCH_STATUSES,
  MOVEMENT_TYPES,
  SCRAPPABLE_BATCH_STATUSES,
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
   * lui-même — une page à la fois, sur une recherche approximative, alors que le scanner tient le
   * numéro exact. La résolution appartient donc au serveur, qui l'obtient d'un accès à l'index
   * `@@unique([organization_id, lot_number])` plutôt que d'un balayage paginé.
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

        // La levée de quarantaine ne traite QUE l'incident froid : réparer la chambre froide ne
        // rend pas consommable un produit contaminé. Tant que la qualité retient le lot, ce canal
        // refuse — sinon il devient une porte dérobée sur la quarantaine qualité, avec une
        // séparation des tâches évaluée sur le mauvais signataire et un repli plus permissif.
        const condemnation = readQualityCondemnation(
          await loadQualityVerdicts(tx, id, activeOrgId)
        );

        if (condemnation && !condemnation.counterAnalysis) {
          throw new APIError(409, {
            error: [
              {
                field: 'statut',
                message:
                  'Ce lot a échoué un contrôle qualité : il ne se libère pas par la levée de quarantaine froid. Enregistrez la contre-analyse conforme, puis levez la quarantaine qualité.',
              },
            ],
          });
        }

        const autoSigned = await enforceSeparationOfDuties(tx, {
          organizationId: activeOrgId,
          batchCreatedBy: batch.created_by,
          actorUserId: userId,
          field: 'batch',
        });

        // On revient au statut d'AVANT la quarantaine froid : un produit fini qui attendait son
        // contrôle de sortie (EN_ATTENTE_QC) y retourne, il ne devient pas expédiable. Faute de
        // statut mémorisé (lot né BLOQUE à une réception non conforme), on retombe sur EN_STOCK.
        const restoredStatus = batch.statut_avant_blocage ?? BATCH_STATUSES.IN_STOCK;

        const updated = await tx.batch.update({
          where: { id },
          data: {
            statut: restoredStatus,
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
            metadata: { motif, statut_precedent: batch.statut, statut_resultant: restoredStatus },
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
              statut: restoredStatus,
              motif,
              ...(autoSigned ? { separation_des_taches: SELF_RELEASE_TRACE } : {}),
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
   * Un lot disponible ou en quarantaine bouge (cf. MOVABLE_BATCH_STATUSES) — évacuer un frigo en
   * panne fait partie du geste ; un lot sous rappel reste immobilisé. Le matériel cible doit être un
   * emplacement de STOCKAGE (pas une cuve/mixeur). Tracé dans l'audit WORM, comme toute écriture à
   * conséquence sanitaire.
   */
  async moveBatch(id: string, activeOrgId: string, userId: string, equipmentId: string) {
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
        if (batch.id_materiel_actuel === equipmentId) {
          return batch;
        }

        if (!(MOVABLE_BATCH_STATUSES as readonly string[]).includes(batch.statut)) {
          throw new APIError(409, {
            error: [
              {
                field: 'statut',
                message: `Un lot dans l'état ${batch.statut} ne peut pas être déplacé. Se rangent ailleurs : un lot disponible (EN_STOCK, EN_ATTENTE_QC) et un lot en quarantaine (BLOQUE), qu'il faut pouvoir évacuer.`,
              },
            ],
          });
        }

        const equipment = await tx.equipment.findFirst({
          where: { id: equipmentId, organization_id: activeOrgId },
        });

        if (!equipment) {
          throw new APIError(404, {
            error: [{ field: 'id_materiel', message: 'Matériel introuvable dans cette organisation' }],
          });
        }

        if (!(STORAGE_EQUIPMENT_TYPES as readonly string[]).includes(equipment.type)) {
          throw new APIError(400, {
            error: [
              {
                field: 'id_materiel',
                message: `Un lot se range dans un emplacement de stockage (frigo, congélateur, étagère), pas dans un équipement de type ${equipment.type}.`,
              },
            ],
          });
        }

        // Verrou optimiste : la version lue est dans le where. Le cas qui le justifie est le
        // passage concurrent sous RAPPEL (`recall.service` incrémente `version`) — on ne déplace
        // pas un lot devenu immobilisé entre la lecture et l'écriture.
        // ⚠️ Effet de bord connu : une excursion froid concurrente incrémente elle aussi `version`,
        // et rend donc un 409 « rechargez la fiche » à l'opérateur qui évacue au moment même de la
        // détection — alors que le lot, devenu BLOQUE, est justement déplaçable. Il lui suffit de
        // réessayer ; refuser à tort coûte moins cher que déplacer un lot dont l'état a changé.
        const updated = await tx.batch.updateMany({
          where: { id, organization_id: activeOrgId, version: batch.version },
          data: { id_materiel_actuel: equipmentId, version: { increment: 1 } },
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

        // Déplacé seul, le lot QUITTE sa palette. On n'interdit pas le geste — l'organisation reste
        // libre de sa manière de travailler — mais on garde une seule vérité sur la position :
        // physiquement, un carton sorti de la palette n'est plus dessus, et laisser le lien
        // ferait annoncer à la palette un contenu qu'elle n'a plus.
        // Le filtre d'organisation est redondant — le lot vient d'être vérifié par `findFirst`
        // avec l'organisation de la session — et il reste là par principe : le cloisonnement se
        // vérifie sur CHAQUE objet d'une requête, y compris quand un appelant en amont l'a déjà
        // fait. C'est la garde qu'on oublie le jour où le chemin d'appel change.
        const removedFromUnit = await tx.logistic_Unit_Content.deleteMany({
          where: { id_lot: id, unite_logistique: { organization_id: activeOrgId } },
        });

        // `quantite`/`unite` portent la quantité concernée par le geste, pas un mouvement de matière.
        await tx.batch_Mouvement.create({
          data: {
            id_lot: id,
            type_action: MOVEMENT_TYPES.MOVE,
            quantite: batch.quantite_actuelle,
            unite: batch.unite_code,
            id_user: userId,
            metadata: {
              from: batch.id_materiel_actuel,
              to: equipmentId,
              ...(removedFromUnit.count > 0 ? { sorti_de_palette: true } : {}),
            },
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
            newValue: { id_materiel_actuel: equipmentId },
          },
          tx
        );

        return tx.batch.findFirst({ where: { id, organization_id: activeOrgId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  },

  /**
   * Lève une quarantaine QUALITÉ — celle qu'un contrôle non conforme a posée.
   *
   * Elle n'existait pas : un lot déclaré non conforme n'avait aucun retour, et les deux canaux
   * existants se renvoyaient l'un à l'autre. Un contrôle saisi par erreur condamnait donc
   * définitivement de la marchandise saine, dont la seule issue était le rebut.
   *
   * La preuve exigée n'est pas un motif libre mais une **contre-analyse conforme postérieure** au
   * dernier verdict non conforme : on ne lève pas une non-conformité par déclaration, on la lève
   * parce qu'un second contrôle l'a démentie. Le motif accompagne, il ne remplace pas.
   */
  async liftQualityQuarantine(id: string, activeOrgId: string, userId: string, motif: string) {
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

        // Même lecture que la levée froid et que l'écran d'alerte : la condamnation se lit à la
        // dernière non-conformité NON démentie, jamais au dernier verdict.
        const condemnation = readQualityCondemnation(
          await loadQualityVerdicts(tx, id, activeOrgId)
        );

        if (!condemnation) {
          throw new APIError(409, {
            error: [
              {
                field: 'statut',
                message:
                  "Ce lot n'est pas en quarantaine qualité : aucun contrôle non conforme ne le retient. S'il est bloqué par une excursion de température, sa levée passe par la levée de quarantaine froid.",
              },
            ],
          });
        }

        // La preuve : un contrôle conforme POSTÉRIEUR à la condamnation. Une levée par simple
        // déclaration ne serait pas une levée : c'est un second contrôle qui dément le premier.
        const counterAnalysis = condemnation.counterAnalysis;

        if (!counterAnalysis) {
          throw new APIError(409, {
            error: [
              {
                field: 'statut',
                message:
                  'Une contre-analyse conforme est requise avant de lever cette quarantaine : enregistrez le contrôle qui dément la non-conformité, puis levez.',
              },
            ],
          });
        }

        // Un lot peut être retenu par DEUX causes à la fois. Le libérer ici alors qu'une excursion
        // de température est en vigueur le sortirait d'un frigo en panne.
        //
        // Deux lectures sont nécessaires, et l'une seule ne suffit pas : les mouvements ne disent
        // rien d'un lot qui était DÉJÀ `BLOQUE` quand l'excursion l'a frappé — `iotAlert.service`
        // ne re-marque pas un lot bloqué (cf. `COLD_QUARANTINABLE_STATUSES`), il n'y a donc aucun
        // `QUARANTAINE_FROID` à trouver. C'est précisément le lot qui nous occupe ici.
        const movements = await tx.batch_Mouvement.findMany({
          where: {
            id_lot: id,
            type_action: {
              in: [MOVEMENT_TYPES.COLD_QUARANTINE, MOVEMENT_TYPES.QUARANTINE_LIFTED],
            },
          },
          select: { id: true, type_action: true },
          orderBy: { id: 'asc' },
        });

        const coldIsolation = [...movements]
          .reverse()
          .find((m) => m.type_action === MOVEMENT_TYPES.COLD_QUARANTINE);
        const coldLifted =
          coldIsolation !== undefined &&
          movements.some(
            (m) => m.id > coldIsolation.id && m.type_action === MOVEMENT_TYPES.QUARANTINE_LIFTED
          );

        // L'angle mort se comble par l'état RÉEL : une excursion non résolue, DÉTECTÉE APRÈS la
        // condamnation, sur l'équipement où le lot se trouve encore. La borne de date fait tout le
        // travail : sans elle, une vieille alerte jamais résolue retiendrait indéfiniment des lots
        // que le froid n'a jamais isolés — ceux que le froid a réellement isolés, eux, portent un
        // mouvement `QUARANTAINE_FROID` et sont traités juste au-dessus.
        const openColdAlert = batch.id_materiel_actuel
          ? await tx.alert.findFirst({
              where: {
                organization_id: activeOrgId,
                id_materiel: batch.id_materiel_actuel,
                type: COLD_CHAIN_ALERT_TYPE,
                statut: 'ACTIVE',
                created_at: { gt: condemnation.nonConformity.date_test },
              },
              select: { id: true },
            })
          : null;

        if ((coldIsolation && !coldLifted) || openColdAlert) {
          throw new APIError(409, {
            error: [
              {
                field: 'statut',
                message:
                  "Ce lot est aussi retenu par une excursion de température non levée : traitez l'incident froid avant la levée qualité.",
              },
            ],
          });
        }

        // La séparation des tâches porte sur le SIGNATAIRE de la non-conformité, pas sur le
        // créateur du lot : sans cela, la personne qui condamne peut décondamner seule, et la
        // garde ne verrait rien.
        const autoSigned = await enforceSeparationOfDuties(tx, {
          organizationId: activeOrgId,
          batchCreatedBy: condemnation.nonConformity.id_user_labo,
          actorUserId: userId,
          field: 'batch',
          message:
            'Vous avez signé la non-conformité de ce lot : sa levée doit être signée par une autre personne habilitée (séparation des tâches).',
        });

        // On rend le lot à l'état d'AVANT le blocage. Faute de statut mémorisé (lots bloqués
        // avant que le contrôle qualité ne l'écrive), on retombe sur l'état le plus PRUDENT :
        // le lot repasse par un contrôle de sortie plutôt que de devenir expédiable.
        const restoredStatus = batch.statut_avant_blocage ?? BATCH_STATUSES.PENDING_QC;

        const updated = await tx.batch.updateMany({
          where: { id, organization_id: activeOrgId, version: batch.version },
          data: {
            statut: restoredStatus,
            statut_avant_blocage: null,
            version: { increment: 1 },
          },
        });

        if (updated.count === 0) {
          throw new APIError(409, {
            error: [
              {
                field: 'statut',
                message:
                  "L'état du lot a changé pendant la levée. Rechargez sa fiche avant de réessayer.",
              },
            ],
          });
        }

        await tx.batch_Mouvement.create({
          data: {
            id_lot: id,
            type_action: MOVEMENT_TYPES.QUALITY_QUARANTINE_LIFTED,
            quantite: batch.quantite_actuelle,
            unite: batch.unite_code,
            id_user: userId,
            metadata: {
              motif,
              statut_restaure: restoredStatus,
              id_contre_analyse: counterAnalysis.id,
              ...(autoSigned ? { separation_des_taches: SELF_RELEASE_TRACE } : {}),
            },
          },
        });

        await auditService.logAction(
          {
            organizationId: activeOrgId,
            userId,
            action: 'LIFT_QUALITY_QUARANTINE',
            entity: 'Batch',
            entityId: id,
            oldValue: { statut: batch.statut },
            newValue: {
              statut: restoredStatus,
              motif,
              id_contre_analyse: counterAnalysis.id,
              signataire_non_conformite: condemnation.nonConformity.id_user_labo,
              ...(autoSigned ? { separation_des_taches: SELF_RELEASE_TRACE } : {}),
            },
          },
          tx
        );

        return tx.batch.findFirst({ where: { id, organization_id: activeOrgId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  },

  /**
   * Met un lot au rebut : destruction tracée, seule issue d'un lot sans autre canal de sortie
   * (rappel ALERTE, ou quarantaine BLOQUE qu'un contrôle qualité a condamnée). Terminal — remet
   * la quantité à zéro et scelle le motif dans l'audit WORM, preuve opposable de destruction.
   *
   * Contrairement à `liftQuarantine`, aucune séparation des tâches n'est exigée ici : celle-ci
   * protège contre le risque de remettre en circulation SA PROPRE production douteuse — l'incitation
   * inverse n'existe pas pour une destruction (elle ne profite jamais à son auteur), et le motif
   * comme l'auteur restent de toute façon scellés dans l'audit WORM.
   */
  async scrapBatch(id: string, activeOrgId: string, userId: string, motif: string) {
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

        if (!(SCRAPPABLE_BATCH_STATUSES as readonly string[]).includes(batch.statut)) {
          throw new APIError(409, {
            error: [
              {
                field: 'statut',
                message: `Seul un lot en quarantaine (BLOQUE) ou sous rappel (ALERTE) peut être mis au rebut. Statut actuel : ${batch.statut}.`,
              },
            ],
          });
        }

        const updated = await tx.batch.updateMany({
          where: { id, organization_id: activeOrgId, version: batch.version },
          data: {
            statut: BATCH_STATUSES.SCRAPPED,
            quantite_actuelle: 0,
            statut_avant_blocage: null,
            version: { increment: 1 },
          },
        });

        if (updated.count === 0) {
          throw new APIError(409, {
            error: [
              {
                field: 'statut',
                message: "L'état du lot a changé avant la mise au rebut. Rechargez sa fiche avant de réessayer.",
              },
            ],
          });
        }

        // Un lot détruit ne repose plus sur aucune palette. Sans ce retrait, la palette continue de
        // le déclarer et devient irrangeable : la garde exige que tout son contenu soit déplaçable,
        // ce qu'un lot au rebut n'est plus.
        await reconcileLogisticUnitContent(tx, {
          batchId: id,
          organizationId: activeOrgId,
          remainingQuantity: 0,
        });

        await tx.scrapRecord.create({
          data: {
            organization_id: activeOrgId,
            id_lot: id,
            quantite: batch.quantite_actuelle,
            unite: batch.unite_code,
            motif,
            id_user: userId,
          },
        });

        await tx.batch_Mouvement.create({
          data: {
            id_lot: id,
            type_action: MOVEMENT_TYPES.SCRAP,
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
            action: 'SCRAP_BATCH',
            entity: 'Batch',
            entityId: id,
            oldValue: { statut: batch.statut, quantite: batch.quantite_actuelle },
            newValue: { statut: BATCH_STATUSES.SCRAPPED, quantite: 0, motif },
          },
          tx
        );

        return tx.batch.findFirst({ where: { id, organization_id: activeOrgId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  },
};
