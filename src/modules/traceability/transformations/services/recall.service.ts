import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { genealogyService } from './genealogy.service';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { logger } from '../../../../shared/utils/logger/logger';
import { auditService } from '../../../../shared/utils/audit/audit.service';

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
}

/**
 * Cap volontaire sur le nombre de `shipmentRef` stockés dans l'audit WORM
 * (Audit_Log.nouvelle_valeur). Le total exact reste dans `affectedShipmentsCount`,
 * la liste complète vit dans la réponse HTTP. Évite le bloat WORM sur rappel massif.
 */
const AUDIT_SHIPMENT_REFS_CAP = 100;

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
    return await prisma.$transaction(
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

        // 2. Récupérer toute la descendance en passant la transaction active (tx)
        const descendants = await genealogyService.getDownstream(batchId, organizationId, tx);
        const allImpactedIds = [batchId, ...descendants.map((b) => b.id)];

        // 3. Bloquer les lots (statut ALERTE + invalidation version pour les transactions en vol)
        await tx.batch.updateMany({
          where: {
            id: { in: allImpactedIds },
            organization_id: organizationId,
          },
          data: {
            statut: 'ALERTE',
            version: { increment: 1 },
          },
        });

        // 4. Identifier les expéditions impactées (déjà parties) — Objectif 5 cascade.
        // Filtre cross-tenant via les DEUX côtés de la jointure (defense-in-depth) :
        // - `expedition.organization_id` : Liaison_Shipment n'a pas de organization_id direct,
        //   on passe par Shipment.
        // - `lot.organization_id` : si `getDownstream` renvoyait un batch hors-org (régression
        //   future), on bloque côté Liaison.
        const liaisons = await tx.liaison_Shipment.findMany({
          where: {
            id_lot: { in: allImpactedIds },
            expedition: { organization_id: organizationId },
            lot: { organization_id: organizationId },
          },
          include: {
            expedition: { include: { client: true } },
          },
        });

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
              impactedIds: allImpactedIds,
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
        };
      },
      {
        timeout: 30000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );
  },
};

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
