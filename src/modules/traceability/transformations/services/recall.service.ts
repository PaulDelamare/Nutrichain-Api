import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { downstreamTraceCte, MAX_GENEALOGY_DEPTH } from './genealogy.service';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { logger } from '../../../../shared/utils/logger/logger';
import { auditService } from '../../../../shared/utils/audit/audit.service';
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
  transporteur: string;
  batchIds: string[]; // sous-ensemble des lots impactés présents dans cette expédition (dédupliqué, trié)
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
    const result = await prisma.$transaction(
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
            SET statut = 'ALERTE', version = version + 1
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
            (SELECT array_agg(id) FROM blocked) AS impacted_ids,
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
        const liaisons: LiaisonHydrated[] = [];
        for (let i = 0; i < allImpactedIds.length; i += LIAISON_IN_CHUNK_SIZE) {
          const idsChunk = allImpactedIds.slice(i, i + LIAISON_IN_CHUNK_SIZE);
          const part = await tx.liaison_Shipment.findMany({
            where: {
              id_lot: { in: idsChunk },
              expedition: { organization_id: organizationId },
              lot: { organization_id: organizationId },
            },
            include: {
              expedition: { include: { client: true } },
            },
          });
          liaisons.push(...part);
        }

        const affectedShipments = aggregateByShipment(liaisons);

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
};

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

  for (const liaison of liaisons) {
    const shipment = liaison.expedition;

    if (!shipment.client) {
      logger.warn(
        `[RECALL] Shipment ${shipment.id} référence un Customer supprimé — skip de l'agrégation`
      );
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
          transporteur: shipment.transporteur,
          batchIds: [], // rempli à la finalisation
        },
        batchSet: new Set([liaison.id_lot]),
      });
    }
  }

  // Finaliser : convertir Set → array trié (ordre stable pour tests + UI)
  return Array.from(accumulator.values()).map(({ shipment, batchSet }) => ({
    ...shipment,
    batchIds: Array.from(batchSet).sort(),
  }));
}
