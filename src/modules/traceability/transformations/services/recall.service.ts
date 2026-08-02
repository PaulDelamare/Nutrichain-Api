import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { downstreamTraceCte, MAX_GENEALOGY_DEPTH } from './genealogy.service';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { logger } from '../../../../shared/utils/logger/logger';
import { auditService } from '../../../../shared/utils/audit/audit.service';
import { retryableTransaction } from '../../../../shared/utils/db/withWriteConflictRetry';
import { notifyOrgAdmins, OrgAdminEmail } from '../../../../shared/utils/mailer/notifyOrgAdmins';
import { notifyRecallCustomers } from './recallNotifications';
import { MOVEMENT_TYPES } from '../../../logistics/constants/logistics.constants';
import { escapeHtml } from '../../../../shared/utils/html/escapeHtml';

/**
 * Liaison_Shipment hydratée avec sa Shipment et Client (via include nested Prisma).
 * Le client peut être null si la référence est cassée (Customer supprimé sans cascade).
 */
interface LiaisonHydrated {
  id_lot: string;
  expedition: {
    id: string;
    shipment_id: string;
    date_envoi: Date;
    statut_livraison: string;
    date_livraison: Date | null;
    transporteur: string;
    id_client: string;
    client: {
      id: string;
      nom_enseigne: string;
      contact_urgence: string | null;
      email: string | null;
      adresse_livraison: string;
    } | null;
  };
}

/**
 * Expédition déjà partie qui contient au moins un lot rappelé.
 * Sert à la notification des clients post-rappel (Objectif SMART n°5).
 */
export interface AffectedShipment {
  shipmentId: string;
  shipmentRef: string;
  customerId: string;
  customerName: string;
  customerContact: string | null;
  customerEmail: string | null;
  customerAddress: string;
  dateEnvoi: Date;
  statutLivraison: string;
  dateLivraison: Date | null;
  transporteur: string;
  batchIds: string[]; // sous-ensemble des lots impactés présents dans cette expédition (dédupliqué, trié)
}

/**
 * Expédition impactée, vue par la SIMULATION : projection réduite, sans le contact ni l'e-mail
 * du client. Le rappel réel est réservé aux rôles qualité ; la simulation est ouverte à la
 * lecture, et ces coordonnées relèvent de `PERSONAL_DATA_ROLES`.
 */
export interface SimulatedShipment {
  shipmentId: string;
  shipmentRef: string;
  customerName: string;
  dateEnvoi: Date;
  statutLivraison: string;
  dateLivraison: Date | null;
  transporteur: string;
  batchIds: string[];
}

export interface RecallSimulationResult {
  /** Total exact, jamais tronqué — c’est le chiffre que le rappel réel bloquerait. */
  impactedCount: number;
  impactedBatchIds: string[];
  impactedBatchIdsTruncated: boolean;
  /** Total exact des expéditions concernées, même quand la liste ci-dessous est coupée. */
  affectedShipmentsCount: number;
  affectedShipments: SimulatedShipment[];
  affectedShipmentsTruncated: boolean;
  depthSaturated: boolean;
}

export interface RecallResult {
  blockedBatchesCount: number;
  impactedBatchIds: string[];
  affectedShipments: AffectedShipment[];
  /**
   * `true` si la garde anti-cycle a été atteinte : la descendance bloquée peut être INCOMPLÈTE
   * (cycle ou chaîne anormalement profonde). L'appelant doit alors déclencher une vérification
   * manuelle — une alerte CRITIQUE est aussi créée côté système.
   */
  depthSaturated: boolean;
}

/**
 * Taille de lot pour le `IN (...)` du join Liaison_Shipment. PostgreSQL plafonne une requête à
 * 65535 paramètres liés : le blocage étant désormais exhaustif (issue #19), `allImpactedIds` peut
 * dépasser ce seuil sur un rappel massif. On découpe pour ne jamais lever (un throw ici = rollback
 * = zéro lot bloqué). Marge confortable sous 65535 (les autres filtres consomment aussi des params).
 */
export const LIAISON_IN_CHUNK_SIZE = 20000;

/**
 * Cap volontaire sur le nombre de `shipmentRef` stockés dans l'audit WORM
 * (Audit_Log.nouvelle_valeur). Le total exact reste dans `affectedShipmentsCount`,
 * la liste complète vit dans la réponse HTTP. Évite le bloat WORM sur rappel massif.
 */
const AUDIT_SHIPMENT_REFS_CAP = 100;

/**
 * Cap volontaire sur l'échantillon d'ids de lots stocké dans l'audit WORM.
 * Le total exact reste dans `impactedCount` ; la liste complète vit dans la réponse HTTP.
 * Sans le fix #19, `impactedIds` était borné à 1000 par la troncature ; le blocage exhaustif
 * le rend non borné → on cape ici pour éviter le bloat WORM (coût hash/recompute) sur rappel massif.
 */
const AUDIT_IMPACTED_IDS_CAP = 100;

/**
 * Cap sur les ids rendus par la SIMULATION. Le GET est rejouable à volonté : sans borne, un lot
 * à la descendance massive ferait transiter la liste entière à chaque appel. `impactedCount`
 * reste exact et `impactedBatchIdsTruncated` dit que la liste est coupée — une troncature muette
 * ferait mentir l’écran, ce que la simulation existe précisément pour éviter.
 */
export const SIMULATION_IDS_CAP = 1000;

/**
 * Cap sur les expéditions rendues par la simulation. Sans lui, borner les ids ne bornait que la
 * partie légère de la réponse : chaque expédition porte ses propres lots, donc un rappel massif
 * faisait transiter la liste entière par un autre chemin. `affectedShipmentsCount` reste exact.
 */
export const SIMULATION_SHIPMENTS_CAP = 200;

export const recallService = {
  /**
   * Déclenche un rappel produit à partir d'un lot source.
   * Passe le lot source et TOUTE sa descendance en statut 'ALERTE'.
   * Identifie aussi les expéditions déjà parties qui contiennent un de ces lots
   * (pour permettre la notification des clients — Objectif SMART n°5).
   */
  async triggerRecall(
    batchId: string,
    organizationId: string,
    userId: string,
    reason: string
  ): Promise<RecallResult> {
    const result = await retryableTransaction(
      async (tx) => {
        // 1. Vérifier l'existence du lot source
        const sourceBatch = await tx.batch.findFirst({
          where: { id: batchId, organization_id: organizationId },
        });

        if (!sourceBatch) {
          throw new APIError(404, {
            error: [{ field: 'batchId', message: 'Lot source introuvable.' }],
          });
        }

        // 2. Bloquer la descendance de façon EXHAUSTIVE et set-based (issue #19).
        // Un seul UPDATE piloté par la CTE récursive — SANS plafond, donc plus de troncature
        // silencieuse — qui renvoie via RETURNING la liste réelle des lots bloqués (source incluse)
        // et la profondeur max atteinte (pour détecter une saturation de la garde anti-cycle).
        // Le filtre `organization_id` sur la cible suffit à l'isolation : une transformation est
        // mono-org (cf. transformation.service), donc la descendance ne franchit jamais le tenant.
        // Le mouvement de rappel est écrit par un INSERT ... SELECT dans la MÊME requête, et non
        // par un createMany applicatif : sur un rappel massif, réinsérer N lignes de 6 colonnes
        // dépasserait le plafond de 65535 paramètres liés de PostgreSQL → throw → rollback →
        // ZÉRO lot bloqué. Set-based, il n'y a ni plafond, ni aller-retour, ni allongement de la tx.
        //
        // `created_at` est fourni explicitement, et converti en UTC. La colonne est un `timestamp`
        // SANS fuseau : le DEFAULT (comme un paramètre `timestamptz` non converti) y écrit l'heure
        // LOCALE du serveur, alors que Prisma y écrit de l'UTC. Sans la conversion, le mouvement de
        // rappel était daté +2 h (Europe/Paris) — l'historique affichait le rappel AVANT la
        // réception qui l'avait précédé.
        const recalledAt = new Date();

        const [blockResult] = await tx.$queryRaw<
          { impacted_ids: string[] | null; max_depth: number | null }[]
        >(Prisma.sql`
          ${downstreamTraceCte(batchId, MAX_GENEALOGY_DEPTH)},
          blocked AS (
            UPDATE "Batch"
            SET statut = 'ALERTE', statut_avant_blocage = NULL, version = version + 1
            WHERE organization_id = ${organizationId}
              AND (id = ${batchId} OR id IN (SELECT DISTINCT id_lot_enfant FROM downstream_trace))
            RETURNING id, quantite_actuelle, unite_code
          ),
          traced AS (
            INSERT INTO "Batch_Mouvement" (id_lot, type_action, quantite, unite, id_user, metadata, created_at)
            SELECT
              b.id,
              ${MOVEMENT_TYPES.RECALL},
              b.quantite_actuelle,
              b.unite_code,
              ${userId},
              jsonb_build_object('motif', ${reason}::text, 'lot_source', ${batchId}::text),
              ${recalledAt}::timestamptz AT TIME ZONE 'UTC'
            FROM blocked b
          )
          SELECT
            (SELECT array_agg(id ORDER BY id) FROM blocked) AS impacted_ids,
            (SELECT MAX(depth) FROM downstream_trace) AS max_depth
        `);

        const allImpactedIds = blockResult?.impacted_ids ?? [batchId];
        const maxDepthReached = blockResult?.max_depth ?? 0;

        // 3. Garde anti-cycle saturée → descendance potentiellement INCOMPLÈTE.
        // Jamais silencieux (issue #19) ET jamais throw : un throw = rollback = ZÉRO lot bloqué,
        // soit la pire issue sanitaire. On bloque ce qu'on a atteint et on signale en CRITIQUE.
        const depthSaturated = maxDepthReached >= MAX_GENEALOGY_DEPTH;
        if (depthSaturated) {
          logger.error(
            `[RECALL] Saturation de profondeur (${maxDepthReached}/${MAX_GENEALOGY_DEPTH}) sur le lot ${batchId} — descendance potentiellement incomplète (cycle ou chaîne anormalement profonde).`
          );
          await tx.alert.create({
            data: {
              organization_id: organizationId,
              type: 'RECALL_DEPTH_SATURATION',
              niveau_gravite: 'CRITIQUE',
              message: `Rappel ${batchId} : profondeur de garde atteinte (${MAX_GENEALOGY_DEPTH}). Vérification manuelle requise — la descendance bloquée peut être incomplète.`,
              related_entity: 'Batch',
              related_id: batchId,
            },
          });
        }

        // 4. Identifier les expéditions impactées (déjà parties) — Objectif 5 cascade.
        // Filtre cross-tenant via les DEUX côtés de la jointure (defense-in-depth) :
        // - `expedition.organization_id` : Liaison_Shipment n'a pas de organization_id direct,
        //   on passe par Shipment.
        // - `lot.organization_id` : si `getDownstream` renvoyait un batch hors-org (régression
        //   future), on bloque côté Liaison.
        // Découpé par lots pour ne jamais dépasser le plafond de 65535 paramètres liés
        // de PostgreSQL sur un rappel massif (cf. LIAISON_IN_CHUNK_SIZE).
        const affectedShipments = await collectAffectedShipments(tx, allImpactedIds, organizationId);

        // 5. Alerte système (criticité maximale)
        await tx.alert.create({
          data: {
            organization_id: organizationId,
            type: 'PRODUCT_RECALL',
            niveau_gravite: 'CRITIQUE',
            message: `RAPPEL DÉCLENCHÉ : ${reason}. Source: ${batchId}. Total lots impactés: ${allImpactedIds.length}. Expéditions à notifier: ${affectedShipments.length}.`,
            related_entity: 'Batch',
            related_id: batchId,
          },
        });

        // 6. Audit WORM (immuable) — newValue enrichi avec count + refs capés
        const shipmentRefs = affectedShipments
          .slice(0, AUDIT_SHIPMENT_REFS_CAP)
          .map((s) => s.shipmentRef);

        await auditService.logAction(
          {
            organizationId,
            userId,
            action: 'BATCH_RECALL_TRIGGERED',
            entity: 'Batch',
            entityId: batchId,
            oldValue: { statut: sourceBatch.statut },
            newValue: {
              statut: 'ALERTE',
              reason,
              impactedCount: allImpactedIds.length,
              impactedIdsSample: allImpactedIds.slice(0, AUDIT_IMPACTED_IDS_CAP), // capé anti-bloat WORM
              affectedShipmentsCount: affectedShipments.length,
              shipmentRefs, // capé à AUDIT_SHIPMENT_REFS_CAP
            },
          },
          tx
        );

        logger.warn(
          `[RECALL] Rappel déclenché par ${userId} pour le lot ${batchId}. ${allImpactedIds.length} lots bloqués. ${affectedShipments.length} expéditions à notifier.`
        );

        return {
          blockedBatchesCount: allImpactedIds.length,
          impactedBatchIds: allImpactedIds,
          affectedShipments,
          depthSaturated,
        };
      },
      {
        timeout: 30000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );

    // Notifications automatiques APRÈS commit (Objectif SMART n°5 : décision → notification < 15 min).
    // Fire-and-forget hors transaction : le rappel est déjà persisté, l'email ne doit ni le bloquer
    // ni l'annuler.
    // 1) Admins de l'organisation (interne). 2) Clients externes dont une expédition contient un
    //    lot rappelé — par email si disponible, sinon contact manuel (téléphone/adresse dans le résultat).
    void notifyOrgAdmins(organizationId, buildRecallEmail(batchId, reason, result));
    void notifyRecallCustomers(result.affectedShipments, batchId, reason);

    return result;
  },

  /**
   * Chiffre l'impact d'un rappel SANS rien écrire : mêmes lots, mêmes expéditions que
   * `triggerRecall`, en lecture seule. Voir les magasins touchés n’exige donc plus de déclencher
   * un rappel réel, qui est irréversible.
   */
  async simulateRecall(batchId: string, organizationId: string): Promise<RecallSimulationResult> {
    return prisma.$transaction(
      async (tx) => {
      const sourceBatch = await tx.batch.findFirst({
        where: { id: batchId, organization_id: organizationId },
        select: { id: true },
      });

      // Même 404 que le rappel réel : sans lui, un lot d’une autre organisation rendrait 200 et
      // une liste vide, soit deux réponses différentes pour le même lot selon le bouton cliqué.
      if (!sourceBatch) {
        throw new APIError(404, {
          error: [{ field: 'batchId', message: 'Lot source introuvable.' }],
        });
      }

      // Le WHERE reproduit celui de l'UPDATE de `triggerRecall`, absence de filtre de statut
      // comprise : un lot déjà BLOQUE, ALERTE ou EPUISE est bloqué par le rappel réel, donc il
      // compte. L’écarter ici produirait la sous-estimation que la simulation doit interdire.
      const [impact] = await tx.$queryRaw<
        { impacted_ids: string[] | null; max_depth: number | null }[]
      >(Prisma.sql`
        ${downstreamTraceCte(batchId, MAX_GENEALOGY_DEPTH)},
        impacted AS (
          SELECT b.id
          FROM "Batch" b
          WHERE b.organization_id = ${organizationId}
            AND (b.id = ${batchId} OR b.id IN (SELECT DISTINCT id_lot_enfant FROM downstream_trace))
        )
        SELECT
          (SELECT array_agg(id ORDER BY id) FROM impacted) AS impacted_ids,
          (SELECT MAX(depth) FROM downstream_trace) AS max_depth
      `);

      // Un agrégat vide ne peut pas vouloir dire « un seul lot concerné » : le lot source vient
      // d'être trouvé dans le même instantané. Se replier sur `[batchId]` annoncerait « 1 lot »
      // sur le seul chiffre qui ne doit jamais mentir.
      if (!impact?.impacted_ids) {
        throw new APIError(404, {
          error: [{ field: 'batchId', message: 'Lot source introuvable.' }],
        });
      }

      const impactedIds = impact.impacted_ids;
      const affectedShipments = await collectAffectedShipments(tx, impactedIds, organizationId);

      return {
        impactedCount: impactedIds.length,
        impactedBatchIds: impactedIds.slice(0, SIMULATION_IDS_CAP),
        impactedBatchIdsTruncated: impactedIds.length > SIMULATION_IDS_CAP,
        affectedShipmentsCount: affectedShipments.length,
        affectedShipments: affectedShipments
          .slice(0, SIMULATION_SHIPMENTS_CAP)
          .map(toSimulatedShipment),
        affectedShipmentsTruncated: affectedShipments.length > SIMULATION_SHIPMENTS_CAP,
        depthSaturated: (impact.max_depth ?? 0) >= MAX_GENEALOGY_DEPTH,
      };
      },
      {
        // Le défaut de Prisma est de 5 s, quand le rappel réel s'en accorde 30 : la simulation
        // aurait échoué en 500 sur les descendances massives — précisément celles qu'on veut
        // chiffrer avant de décider — pendant que le rappel, lui, aboutissait.
        timeout: 30000,
        // En Read Committed, chaque requête prend son propre instantané : la liste des lots et
        // celle des expéditions pouvaient déjà ne plus décrire le même état. RepeatableRead lit
        // tout dans le même instantané, sans le coût du Serializable — rien n'écrit ici.
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      }
    );
  },
};

/**
 * Expéditions déjà parties qui contiennent au moins un des lots impactés.
 *
 * Partagée par le rappel réel et sa simulation : deux requêtes écrites séparément divergeraient
 * au premier changement, et une simulation qui annonce un autre chiffre que le rappel est pire
 * que pas de simulation. Découpée pour ne jamais dépasser le plafond de 65535 paramètres liés de
 * PostgreSQL, et cloisonnée par les DEUX côtés de la jointure (l’expédition ET le lot).
 */
async function collectAffectedShipments(
  db: Prisma.TransactionClient,
  impactedIds: string[],
  organizationId: string
): Promise<AffectedShipment[]> {
  const liaisons: LiaisonHydrated[] = [];

  for (let i = 0; i < impactedIds.length; i += LIAISON_IN_CHUNK_SIZE) {
    const idsChunk = impactedIds.slice(i, i + LIAISON_IN_CHUNK_SIZE);
    const part = await db.liaison_Shipment.findMany({
      where: {
        id_lot: { in: idsChunk },
        expedition: { organization_id: organizationId },
        lot: { organization_id: organizationId },
      },
      include: {
        expedition: { include: { client: true } },
      },
      // Sans tri, Postgres rend les lignes dans l'ordre physique : réécrire une expédition la
      // déplace, et la liste des magasins touchés change d'un appel à l'autre sans qu'aucune
      // donnée métier n'ait bougé.
      orderBy: { id: 'asc' },
    });
    liaisons.push(...part);
  }

  return aggregateByShipment(liaisons);
}

/**
 * Réduit une expédition impactée à ce que la simulation a le droit de montrer. Les champs sont
 * recopiés un par un, et non par diffusion : un champ ajouté plus tard à `AffectedShipment`
 * (une coordonnée client, par exemple) ne doit pas se retrouver ici sans décision explicite.
 */
function toSimulatedShipment(shipment: AffectedShipment): SimulatedShipment {
  return {
    shipmentId: shipment.shipmentId,
    shipmentRef: shipment.shipmentRef,
    customerName: shipment.customerName,
    dateEnvoi: shipment.dateEnvoi,
    statutLivraison: shipment.statutLivraison,
    dateLivraison: shipment.dateLivraison,
    transporteur: shipment.transporteur,
    batchIds: shipment.batchIds,
  };
}

/**
 * Construit l'email de rappel destiné aux admins de l'organisation.
 * Le motif et l'identifiant de lot sont échappés (saisie utilisateur → anti-XSS inbox).
 */
function buildRecallEmail(batchId: string, reason: string, result: RecallResult): OrgAdminEmail {
  const safeBatchId = escapeHtml(batchId);
  const safeReason = escapeHtml(reason);
  return {
    subject: `[RAPPEL PRODUIT] Lot ${safeBatchId} — action immédiate requise`,
    html: `
      <h2>Rappel produit déclenché</h2>
      <p>Lot source : <strong>${safeBatchId}</strong></p>
      <p>Motif : ${safeReason}</p>
      <p>Lots impactés (source + descendance) : <strong>${result.blockedBatchesCount}</strong></p>
      <p>Expéditions déjà parties à notifier : <strong>${result.affectedShipments.length}</strong></p>
      <p>Connectez-vous à NutriChain pour traiter le rappel sans délai.</p>
    `,
  };
}

/**
 * Agrège les Liaison_Shipment par expédition.
 * - Dédoublonne les batchIds (un même lot peut être lié plusieurs fois si plusieurs palettes)
 * - Trie batchIds en ordre stable (ASC) pour reproductibilité côté UI/tests
 * - Skip silencieusement les expéditions dont le client est null (drift référentiel),
 *   avec un warning UNIQUEMENT sur le shipmentId (jamais de PII contact/adresse).
 *
 * Utilise une Map intermédiaire `{ shipment, batchSet }` plutôt qu'un champ `_batchSet`
 * polluant le type public — séparation propre entre l'état d'agrégation et le résultat.
 */
function aggregateByShipment(liaisons: LiaisonHydrated[]): AffectedShipment[] {
  const accumulator = new Map<string, { shipment: AffectedShipment; batchSet: Set<string> }>();
  const orphanShipmentIds = new Set<string>();

  for (const liaison of liaisons) {
    const shipment = liaison.expedition;

    if (!shipment.client) {
      orphanShipmentIds.add(shipment.id);
      continue;
    }

    const existing = accumulator.get(shipment.id);
    if (existing) {
      existing.batchSet.add(liaison.id_lot);
    } else {
      accumulator.set(shipment.id, {
        shipment: {
          shipmentId: shipment.id,
          shipmentRef: shipment.shipment_id,
          customerId: shipment.client.id,
          customerName: shipment.client.nom_enseigne,
          customerContact: shipment.client.contact_urgence,
          customerEmail: shipment.client.email,
          customerAddress: shipment.client.adresse_livraison,
          dateEnvoi: shipment.date_envoi,
          statutLivraison: shipment.statut_livraison,
          // Le statut seul ne suffit pas au decideur : « livre » sans date ne dit pas si la
          // marchandise est en rayon depuis une heure ou trois semaines.
          dateLivraison: shipment.date_livraison,
          transporteur: shipment.transporteur,
          batchIds: [], // rempli à la finalisation
        },
        batchSet: new Set([liaison.id_lot]),
      });
    }
  }

  // Un seul avertissement par appel, et non un par liaison : ce chemin est désormais atteint par
  // un GET rejouable, où une dérive référentielle inonderait le journal.
  if (orphanShipmentIds.size > 0) {
    logger.warn(
      `[RECALL] ${orphanShipmentIds.size} expédition(s) référencent un Customer supprimé — exclues de l'agrégation : ${Array.from(orphanShipmentIds).join(', ')}`
    );
  }

  // Ordre stable de bout en bout : les lots par id, les expéditions par référence (unique par
  // organisation). L'ordre d'insertion d'une Map dépend de l'ordre des lignes rendues par Postgres.
  return Array.from(accumulator.values())
    .map(({ shipment, batchSet }) => ({
      ...shipment,
      batchIds: Array.from(batchSet).sort(),
    }))
    .sort((left, right) => left.shipmentRef.localeCompare(right.shipmentRef));
}
