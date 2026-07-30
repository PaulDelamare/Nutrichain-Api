import { Prisma } from '@prisma/client';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../../shared/utils/audit/audit.service';
import { retryableTransaction } from '../../../../shared/utils/db/withWriteConflictRetry';
import { gs1Utils } from '../../../../shared/utils/gs1/gs1.utils';
import { resolveGs1Prefix } from '../../../../shared/utils/gs1/gs1Prefix';
import { nextSsccSerial } from '../../../../shared/utils/gs1/ssccSerial';
import { reconcileLogisticUnitContent } from '../../shared/utils/reconcileLogisticUnitContent';
import { stripSsccAi } from '../../../../shared/utils/gs1/sscc';
import {
  EPCIS_ACTION,
  EPCIS_BIZSTEP,
  EPCIS_DISPOSITION,
  EPCIS_EVENT_TYPE,
  EPCIS_RELATED_ENTITY,
} from '../../../../shared/constants/epcis.constants';
import {
  BATCH_STATUSES,
  BLOCKING_BATCH_STATUSES,
  MOVEMENT_TYPES,
  isBatchBlocked,
} from '../../constants/logistics.constants';

/**
 * `@@unique([organization_id, shipment_id])` fait déjà barrage au doublon ; sans traduction,
 * l'expéditeur reçoit un 500 illisible alors que son geste est légitime — il lui suffit de
 * choisir un autre numéro de bon.
 */
async function createShipmentOrRejectDuplicate(
  tx: Prisma.TransactionClient,
  data: Prisma.ShipmentUncheckedCreateInput
) {
  try {
    return await tx.shipment.create({ data });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new APIError(409, {
        error: [
          {
            field: 'shipment_id',
            message: `L'expédition ${data.shipment_id} existe déjà dans cette organisation.`,
          },
        ],
      });
    }
    throw error;
  }
}

/**
 * Plafond de lignes APRÈS développement des palettes. C'est cette grandeur qui décide de la taille
 * de la transaction, pas le nombre d'entrées du payload.
 */
const MAX_SHIPMENT_LINES = 500;

/**
 * Une ligne d'expédition, et d'où elle vient.
 *
 * `palette` est nulle pour un lot chargé en vrac. Elle sert deux fois : à inscrire le contenant sur
 * la liaison, et à rendre une erreur EXPLOITABLE — un opérateur qui a scanné un SSCC ne peut rien
 * faire d'un message qui lui oppose l'UUID d'un lot et un champ `lots` qu'il n'a pas rempli.
 */
type ShipmentLine = {
  id_lot: string;
  quantite: number;
  id_unite_logistique: string | null;
  sscc: string | null;
};

/** Une palette effectivement chargée : ce que l'audit et les événements EPCIS doivent nommer. */
type LoadedPallet = { id: string; sscc: string };

/**
 * Désigne une ligne dans un message d'erreur, avec ce que l'appelant a réellement fourni.
 *
 * Un opérateur qui pousse une palette de quarante lots n'a saisi aucun `lots` et n'a jamais vu
 * d'UUID : lui opposer les deux rend l'erreur inexploitable — le client ne peut ni surligner le
 * champ ni traduire l'identifiant. On lui rend donc le numéro de lot et le SSCC qu'il a scanné.
 */
function designateLine(
  line: ShipmentLine,
  lotNumber?: string
): { field: string; cible: string } {
  const identite = lotNumber ?? line.id_lot;
  return line.sscc
    ? { field: 'palettes', cible: `${identite} (palette ${line.sscc})` }
    : { field: 'lots', cible: identite };
}

/**
 * Développe les palettes scannées en lignes d'expédition.
 *
 * Charger une palette est le geste du quai : on ne dicte pas une liste de lots, on pousse un
 * contenant. Son contenu fait foi — c'est ce qui rend l'origine de la marchandise CERTAINE, là où
 * une expédition de lots en vrac ne dit jamais si ce qui part vient d'une palette ou du sol.
 */
async function expandPallets(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    items: Array<{ id_lot: string; quantite: number }>;
    ssccs: string[];
  }
): Promise<{ items: ShipmentLine[]; palettes: LoadedPallet[] }> {
  const lignes: ShipmentLine[] = [];
  const palettes: LoadedPallet[] = [];
  const dejaCharge = new Map<string, string>();

  // Le même lot deux fois EN VRAC était déduit deux fois : deux `updateMany`, deux liaisons, deux
  // mouvements de stock pour une seule marchandise. La garde existait déjà côté palette — il n'y
  // avait aucune raison de ne pas la brancher des deux côtés.
  for (const item of params.items) {
    if (dejaCharge.has(item.id_lot)) {
      throw new APIError(400, {
        error: [
          {
            field: 'lots',
            message: `Le lot ${item.id_lot} figure deux fois sur ce bon. Additionnez les quantités en une seule ligne.`,
          },
        ],
      });
    }
    dejaCharge.set(item.id_lot, 'en vrac');
    lignes.push({ ...item, id_unite_logistique: null, sscc: null });
  }

  const vus = new Set<string>();

  for (const brut of params.ssccs) {
    const sscc = stripSsccAi(brut);

    if (vus.has(sscc)) {
      throw new APIError(400, {
        error: [
          { field: 'palettes', message: `La palette ${sscc} figure deux fois sur ce bon.` },
        ],
      });
    }
    vus.add(sscc);

    const unit = await tx.logistic_Unit.findFirst({
      where: { sscc, organization_id: params.organizationId },
      include: { contenu: true, liaisons: { select: { id: true }, take: 1 } },
    });

    // 404 volontairement indistinct du « SSCC d'une autre organisation ».
    if (!unit) {
      throw new APIError(404, {
        error: [{ field: 'palettes', message: `Palette ${sscc} introuvable dans cette organisation` }],
      });
    }

    // Une palette ne part qu'une fois. Sans cette garde, rescanner le même SSCC déduisait le stock
    // une seconde fois — et le verrou optimiste du lot ne l'aurait pas vu, puisque chaque appel
    // relit un état frais.
    if (unit.liaisons.length > 0) {
      throw new APIError(409, {
        error: [
          {
            field: 'palettes',
            message: `La palette ${sscc} est déjà partie sur une expédition.`,
          },
        ],
      });
    }

    if (unit.contenu.length === 0) {
      throw new APIError(409, {
        error: [
          {
            field: 'palettes',
            message: `La palette ${sscc} ne porte aucun lot : il n'y a rien à charger.`,
          },
        ],
      });
    }

    for (const contenu of unit.contenu) {
      const source = dejaCharge.get(contenu.id_lot);
      if (source) {
        throw new APIError(400, {
          error: [
            {
              field: 'palettes',
              message: `Le lot ${contenu.id_lot} est déjà chargé (${source}) : il ne peut pas partir deux fois sur le même bon.`,
            },
          ],
        });
      }
      dejaCharge.set(contenu.id_lot, `sur la palette ${sscc}`);
      lignes.push({
        id_lot: contenu.id_lot,
        quantite: Number(contenu.quantite),
        id_unite_logistique: unit.id,
        sscc: unit.sscc,
      });
    }

    palettes.push({ id: unit.id, sscc: unit.sscc });
  }

  // La borne de `lots` (500) ne protégeait plus rien : 50 palettes de 100 lots développent 5 000
  // lignes, à plusieurs requêtes chacune, dans une transaction Serializable au timeout Prisma par
  // défaut de 5 s. Le plafond porte donc sur le TOTAL après développement — la seule grandeur qui
  // décide vraiment de la taille de la transaction.
  if (lignes.length > MAX_SHIPMENT_LINES) {
    throw new APIError(400, {
      error: [
        {
          field: 'palettes',
          message: `Ce bon porte ${lignes.length} lignes une fois les palettes développées, au-delà des ${MAX_SHIPMENT_LINES} admises. Scindez l'expédition.`,
        },
      ],
    });
  }

  return { items: lignes, palettes };
}

/**
 * Service pour la gestion des Expéditions (Shipments)
 */
export const shipmentService = {
  /**
   * Créer une expédition et déduire les stocks des lots associés.
   */
  async createShipment(data: {
    organization_id: string;
    id_client: string;
    shipment_id: string;
    transporteur: string;
    destination_adresse?: string;
    date_envoi: Date;
    created_by: string;
    items: Array<{ id_lot: string; quantite: number }>;
    /** SSCC des palettes chargées telles quelles. Leur contenu devient des lignes d'expédition. */
    palettes?: string[];
  }) {
    // Serializable + verrou optimiste (version) sur la déduction de stock : c'était le SEUL chemin
    // d'écriture en Read Committed sans garde. Une expédition qui lit un lot EN_STOCK pouvait écraser
    // un rappel posé entre-temps (le lot repartait chez le client), et deux expéditions concurrentes
    // du même lot passaient toutes les deux (sur-expédition / stock négatif). Rejoué sur conflit.
    // Une expédition vide se refuse AVANT d'ouvrir une transaction et de chercher le client : le
    // geste n'a pas de sens, et le dire tôt oriente l'erreur sur le bon champ. VineJS ne sait pas
    // exprimer « au moins l'un des deux », d'où cette garde ici.
    if (data.items.length === 0 && (data.palettes ?? []).length === 0) {
      throw new APIError(400, {
        error: [{ field: 'lots', message: 'Une expédition porte au moins un lot ou une palette.' }],
      });
    }

    return await retryableTransaction(async (tx) => {
      // 0.a Le client destinataire doit appartenir à l'organisation (anti-référence cross-tenant).
      // Symétrique au contrôle du fournisseur à la réception : sans cette garde, un id_client
      // d'une autre org serait accepté (et notifié lors d'un rappel).
      const customer = await tx.customer.findFirst({
        where: { id: data.id_client, organization_id: data.organization_id },
        select: { id: true, is_active: true },
      });
      if (!customer) {
        throw new APIError(404, {
          error: [{ field: 'id_client', message: 'Client introuvable ou accès refusé.' }],
        });
      }
      // Un client archivé ne reçoit plus d'expédition : la désactivation bloque l'écriture.
      if (!customer.is_active) {
        throw new APIError(409, {
          error: [
            { field: 'id_client', message: 'Ce client est archivé : aucune nouvelle expédition.' },
          ],
        });
      }

      // 0.a bis Développer les palettes chargées : leur contenu devient des lignes d'expédition.
      const { items, palettes } = await expandPallets(tx, {
        organizationId: data.organization_id,
        items: data.items,
        ssccs: data.palettes ?? [],
      });

      // 0.b Préfixe entreprise GS1 de l'organisation (SSCC + URN LGTIN)
      const gs1Prefix = await resolveGs1Prefix(tx, data.organization_id);

      // 0.c Génération automatique de l'identifiant si demandé (Standard SSCC)
      let finalShipmentId = data.shipment_id;
      let ssccAutoGenerated = false;
      if (finalShipmentId === 'AUTO' || !finalShipmentId) {
        finalShipmentId = gs1Utils.generateSSCC(await nextSsccSerial(tx), gs1Prefix);
        ssccAutoGenerated = true;
      }

      // 1. Créer l'entête de l'expédition
      const shipment = await createShipmentOrRejectDuplicate(tx, {
        organization_id: data.organization_id,
        id_client: data.id_client,
        shipment_id: finalShipmentId,
        transporteur: data.transporteur,
        destination_adresse: data.destination_adresse,
        date_envoi: data.date_envoi,
        statut_livraison: 'EN_ROUTE',
        created_by: data.created_by,
      });

      // 2. Traiter chaque lot (Déduction de stock + Liaison)
      const shippedQuantities: Array<{ epcClass: string; quantity: number; uom: string }> = [];
      for (const item of items) {
        const batch = await tx.batch.findFirst({
          where: {
            id: item.id_lot,
            organization_id: data.organization_id,
          },
          include: { produit: { select: { code_gtin: true } } },
        });

        const designation = designateLine(item, batch?.lot_number);

        if (!batch) {
          throw new APIError(404, {
            error: [
              {
                field: designation.field,
                message: `Lot ${designation.cible} introuvable ou accès refusé.`,
              },
            ],
          });
        }

        // 3. Validation des règles métier (Qualité & Date)
        // Bloque l'expédition d'un lot en quarantaine (BLOQUE) ou sous rappel/alerte (ALERTE) :
        // un lot rappelé ne doit jamais pouvoir partir.
        if (isBatchBlocked(batch.statut)) {
          throw new APIError(400, {
            error: [
              {
                field: designation.field,
                message: `Le lot ${designation.cible} est en statut ${batch.statut} et ne peut être expédié.`,
              },
            ],
          });
        }

        if (batch.date_peremption && batch.date_peremption < new Date()) {
          throw new APIError(400, {
            error: [
              { field: designation.field, message: `Le lot ${designation.cible} est périmé.` },
            ],
          });
        }

        if (batch.quantite_actuelle.toNumber() < item.quantite) {
          throw new APIError(400, {
            error: [
              {
                field: designation.field,
                message: `Stock insuffisant pour le lot ${designation.cible}.`,
              },
            ],
          });
        }

        // 4. Déduire le stock — écriture CONDITIONNELLE (verrou optimiste). Le `where` rejoue les
        // gardes lues plus haut au moment de l'écriture : même version (aucune décision — rappel,
        // quarantaine, expédition concurrente — intercalée depuis la lecture) et statut non bloquant.
        // Si l'état a bougé, `count === 0` → 409 : on refuse plutôt que d'écraser la décision récente.
        const updated = await tx.batch.updateMany({
          where: {
            id: item.id_lot,
            organization_id: data.organization_id,
            version: batch.version,
            statut: { notIn: BLOCKING_BATCH_STATUSES as string[] },
          },
          data: {
            quantite_actuelle: { decrement: item.quantite },
            statut:
              batch.quantite_actuelle.toNumber() === item.quantite
                ? BATCH_STATUSES.SHIPPED
                : BATCH_STATUSES.IN_STOCK,
            version: { increment: 1 },
          },
        });

        if (updated.count === 0) {
          throw new APIError(409, {
            error: [
              {
                field: designation.field,
                message: `Le lot ${designation.cible} a changé d'état pendant l'expédition (rappel, quarantaine ou expédition concurrente). Rechargez la fiche du lot avant de réessayer.`,
              },
            ],
          });
        }

        if (item.id_unite_logistique) {
          // La ligne vient d'une palette CHARGÉE : l'origine est certaine, ce qui part est
          // exactement ce que la palette portait. Sa ligne de contenu s'en va donc entièrement —
          // c'est le seul cas où l'on peut l'affirmer (cf. #297).
          await tx.logistic_Unit_Content.delete({
            where: {
              id_unite_logistique_id_lot: {
                id_unite_logistique: item.id_unite_logistique,
                id_lot: item.id_lot,
              },
            },
          });
        } else {
          // Lot chargé en vrac : on ignore si la marchandise venait d'une palette ou du sol. On se
          // borne donc à ce qu'on peut affirmer — une palette ne déclare jamais plus que le stock
          // restant du lot. Sous-déclarer ferait manquer de la marchandise au rappel.
          await reconcileLogisticUnitContent(tx, {
            batchId: item.id_lot,
            organizationId: data.organization_id,
            // Soustraction en Decimal, pas en `number` : `100.3 - 30.1` vaut 70.19999999999999 en
            // virgule flottante, et la palette afficherait ce nombre au scan pendant que le lot en
            // déclare 70.2. La transformation fait déjà la sienne en Decimal.
            remainingQuantity: batch.quantite_actuelle.minus(item.quantite).toNumber(),
          });
        }

        // 5. Créer la liaison
        await tx.liaison_Shipment.create({
          data: {
            id_expedition: shipment.id,
            id_lot: item.id_lot,
            quantite_expediee: item.quantite,
            // La palette sur laquelle ce lot a voyage. Sans elle, un rappel sait quel LOT est parti
            // mais pas quel contenant retirer du camion.
            id_unite_logistique: item.id_unite_logistique,
            unite: batch.unite_code,
          },
        });

        // 6. Enregistrer le mouvement (Audit-Trail)
        await tx.batch_Mouvement.create({
          data: {
            id_lot: item.id_lot,
            type_action: MOVEMENT_TYPES.SHIPMENT,
            quantite: item.quantite,
            unite: batch.unite_code,
            id_expedition: shipment.id,
            id_user: data.created_by,
          },
        });

        shippedQuantities.push({
          epcClass: gs1Utils.buildLgtinUrn(gs1Prefix, batch.produit.code_gtin, batch.lot_number),
          quantity: item.quantite,
          uom: batch.unite_code,
        });
      }

      // 7. Événement EPCIS ObjectEvent : sortie des lots de la chaîne lors de l'expédition.
      // Lots identifiés au niveau classe (URN LGTIN) dans quantityList.
      await tx.ePCIS_Event.create({
        data: {
          organization_id: data.organization_id,
          event_time: new Date(),
          event_type: EPCIS_EVENT_TYPE.object,
          related_entity: EPCIS_RELATED_ENTITY.shipment,
          related_id: shipment.id,
          payload: {
            quantityList: shippedQuantities,
            action: EPCIS_ACTION.observe,
            bizStep: EPCIS_BIZSTEP.shipping,
            disposition: EPCIS_DISPOSITION.inTransit,
            destinationParty: data.id_client,
            sscc: finalShipmentId,
          },
        },
      });

      // 7 bis. Désagréger les palettes chargées, AVANT d'agréger l'expédition.
      //
      // Sans cet événement, deux contenants GS1 revendiquent la même marchandise pour toujours : la
      // palette l'a agrégée à la palettisation (action ADD) et rien ne l'en a jamais retirée, si
      // bien qu'un consommateur EPCIS qui recompose la containment lit les lots à deux endroits à la
      // fois. Le SSCC de la palette est généré par nous, donc porte le préfixe de l'organisation.
      for (const palette of palettes) {
        await tx.ePCIS_Event.create({
          data: {
            organization_id: data.organization_id,
            event_time: new Date(),
            event_type: EPCIS_EVENT_TYPE.aggregation,
            // Rattaché à la PALETTE, pas à l'expédition : c'est sa chronologie de contenant qu'on
            // referme, et c'est elle qu'un consommateur interroge pour recomposer la containment.
            related_entity: EPCIS_RELATED_ENTITY.logisticUnit,
            related_id: palette.id,
            payload: {
              parentID: gs1Utils.buildSsccUrn(gs1Prefix, palette.sscc),
              childQuantityList: shippedQuantities.filter(
                (_, index) => items[index]?.id_unite_logistique === palette.id
              ),
              action: EPCIS_ACTION.delete,
              bizStep: EPCIS_BIZSTEP.unpacking,
            },
          },
        });
      }

      // 8. Événement EPCIS AggregationEvent : le contenant (SSCC) agrège les lots expédiés.
      // L'URN SSCC n'a de sens que pour un SSCC que NOUS avons généré avec ce préfixe ;
      // un identifiant fourni par l'appelant (même 18 chiffres) est conservé tel quel.
      const parentId = ssccAutoGenerated
        ? gs1Utils.buildSsccUrn(gs1Prefix, finalShipmentId)
        : finalShipmentId;

      await tx.ePCIS_Event.create({
        data: {
          organization_id: data.organization_id,
          event_time: new Date(),
          event_type: EPCIS_EVENT_TYPE.aggregation,
          related_entity: EPCIS_RELATED_ENTITY.shipment,
          related_id: shipment.id,
          payload: {
            parentID: parentId,
            childQuantityList: shippedQuantities,
            action: EPCIS_ACTION.add,
            bizStep: EPCIS_BIZSTEP.shipping,
          },
        },
      });

      // 9. Audit WORM — l'expédition est le moment où la marchandise quitte l'usine. Sans ce maillon,
      // « qui a expédié ce lot, quand, vers qui » ne reposait que sur Batch_Mouvement (mutable, non
      // chaîné) : la preuve d'intégrité s'arrêtait à la porte du camion. Scellé DANS la transaction.
      await auditService.logAction(
        {
          organizationId: data.organization_id,
          userId: data.created_by,
          action: 'CREATE_SHIPMENT',
          entity: 'Shipment',
          entityId: shipment.id,
          newValue: {
            shipment_id: finalShipmentId,
            id_client: data.id_client,
            transporteur: data.transporteur,
            date_envoi: data.date_envoi,
            lots: items.map((i) => ({ id_lot: i.id_lot, quantite: i.quantite })),
            // La preuve WORM doit dire ce qui est PHYSIQUEMENT parti, pas seulement quels lots.
            palettes: palettes.map((p) => p.sscc),
          },
        },
        tx
      );

      return shipment;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  },
};
