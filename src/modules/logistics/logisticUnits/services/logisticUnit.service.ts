import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../../shared/utils/audit/audit.service';
import { retryableTransaction } from '../../../../shared/utils/db/withWriteConflictRetry';
import { gs1Utils } from '../../../../shared/utils/gs1/gs1.utils';
import { resolveGs1Prefix } from '../../../../shared/utils/gs1/gs1Prefix';
import { nextSsccSerial } from '../../../../shared/utils/gs1/ssccSerial';
import {
  EPCIS_ACTION,
  EPCIS_BIZSTEP,
  EPCIS_EVENT_TYPE,
} from '../../../../shared/constants/epcis.constants';
import {
  BATCH_STATUSES,
  MOVABLE_BATCH_STATUSES,
  MOVEMENT_TYPES,
  PALLETIZABLE_BATCH_STATUSES,
} from '../../constants/logistics.constants';
import { STORAGE_EQUIPMENT_TYPES } from '../../../organization/middlewares/equipment.schema';

/** Source d'un SSCC : celui que nous avons émis, ou celui lu sur une palette reçue. */
export const LOGISTIC_UNIT_SOURCES = {
  INTERNAL: 'INTERNE',
  SUPPLIER: 'FOURNISSEUR',
} as const;

export interface LogisticUnitItem {
  id_lot: string;
  quantite: number;
}

export interface CreateLogisticUnitParams {
  organizationId: string;
  userId: string;
  items: LogisticUnitItem[];
}

const CONTENT_INCLUDE = {
  contenu: {
    include: {
      lot: {
        select: {
          id: true,
          lot_number: true,
          statut: true,
          date_peremption: true,
          id_materiel_actuel: true,
          produit: { select: { nom: true, code_gtin: true } },
        },
      },
    },
  },
} as const;

/**
 * `Serializable` comme `moveBatch`, qui écrit exactement le même champ : deux fonctions qui
 * déplacent un lot ne doivent pas raisonner sous deux isolations différentes. Les conflits de
 * sérialisation sont rejoués par `retryableTransaction`.
 *
 * Le timeout est explicite : jusqu'à 100 lots, chacun avec son écriture conditionnelle, plus le
 * maillon d'audit. Le défaut Prisma de 5 s sortait en P2028 — non retryable — sur les grosses
 * palettes, c'est-à-dire précisément le cas d'usage visé. `maxWait` est relevé pour la même raison :
 * sous rafale, attendre une connexion plus longtemps vaut mieux qu'un P2028 que personne ne rejoue.
 */
const MOVE_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  timeout: 15_000,
  maxWait: 10_000,
} as const;

/**
 * Unité logistique : la palette, et son identité GS1.
 *
 * Le SSCC est attribué **ici**, à la palettisation. Il l'était auparavant à l'expédition, dans
 * `Shipment.shipment_id` : la palette n'existait donc que pour sortir, et douze palettes d'un même
 * camion partageaient un identifiant unique. Le contenant, lui, est monté avant le départ, stocké,
 * transporté, puis rangé tel quel par le destinataire — son identité doit couvrir tout ce cycle.
 */
export const logisticUnitService = {
  /**
   * Constitue une palette et lui attribue son SSCC.
   *
   * Ne déduit AUCUN stock : la déduction reste à l'expédition, là où vit le verrou optimiste.
   * Conséquence assumée et documentée — rien n'empêche de monter deux palettes sur le même stock,
   * l'incohérence se découvre au départ du camion.
   */
  async createLogisticUnit(params: CreateLogisticUnitParams) {
    const { organizationId, userId, items } = params;

    // Doublon détecté AVANT la base : la clé primaire composite le rejetterait en P2002, que
    // l'`errorHandler` traduit en 409 « ressource déjà existante » — un message qui n'aide pas
    // l'opérateur à comprendre qu'il a scanné deux fois le même lot.
    const seen = new Set<string>();
    const duplicate = items.find((item) => {
      if (seen.has(item.id_lot)) return true;
      seen.add(item.id_lot);
      return false;
    });
    if (duplicate) {
      throw new APIError(400, {
        error: [
          {
            field: 'items',
            message: `Le lot ${duplicate.id_lot} figure deux fois sur la palette. Additionnez les quantités en une seule ligne.`,
          },
        ],
      });
    }

    return retryableTransaction(async (tx) => {
      const batches = await tx.batch.findMany({
        where: {
          id: { in: items.map((item) => item.id_lot) },
          organization_id: organizationId,
        },
        select: {
          id: true,
          lot_number: true,
          statut: true,
          quantite_actuelle: true,
          unite_code: true,
          produit: { select: { code_gtin: true } },
        },
      });

      const byId = new Map(batches.map((batch) => [batch.id, batch]));

      for (const item of items) {
        const batch = byId.get(item.id_lot);

        // 404 volontairement indistinct du « lot d'une autre organisation » : répondre autre chose
        // confirmerait l'existence d'un lot d'un tenant voisin.
        if (!batch) {
          throw new APIError(404, {
            error: [{ field: 'items', message: `Lot ${item.id_lot} introuvable dans cette organisation` }],
          });
        }

        if (!(PALLETIZABLE_BATCH_STATUSES as readonly string[]).includes(batch.statut)) {
          throw new APIError(409, {
            error: [
              {
                field: 'items',
                message: `Le lot ${batch.lot_number} est dans l'état ${batch.statut} : il ne se palettise pas avec de la marchandise disponible.`,
              },
            ],
          });
        }

        if (item.quantite > Number(batch.quantite_actuelle)) {
          throw new APIError(400, {
            error: [
              {
                field: 'items',
                message: `Le lot ${batch.lot_number} ne porte que ${Number(batch.quantite_actuelle)} ${batch.unite_code}, or la palette en réclame ${item.quantite}.`,
              },
            ],
          });
        }
      }

      // Un lot est sur AU PLUS UNE palette : la contrainte est en base (`@@unique([id_lot])`), on la
      // vérifie ici pour rendre un message exploitable plutôt qu'un 409 « ressource déjà existante »
      // qui n'apprend rien à l'opérateur.
      const dejaPalettises = await tx.logistic_Unit_Content.findMany({
        where: {
          id_lot: { in: items.map((item) => item.id_lot) },
          unite_logistique: { organization_id: organizationId },
        },
        include: {
          unite_logistique: { select: { sscc: true } },
          lot: { select: { lot_number: true } },
        },
      });

      if (dejaPalettises.length > 0) {
        const premier = dejaPalettises[0];
        throw new APIError(409, {
          error: [
            {
              field: 'items',
              // Pas « sortez-le d'abord » : le seul geste qui détache un lot est de le DÉPLACER,
              // et déplacer vers son emplacement actuel est un no-op qui ne détache rien. Le
              // message doit donc désigner un déplacement réel, sinon l'opérateur boucle.
              message: `Le lot ${premier.lot.lot_number} est déjà sur la palette ${premier.unite_logistique.sscc}. Déplacez-le vers un autre emplacement pour l'en retirer, ou déclarez un lot distinct pour cette palette.`,
            },
          ],
        });
      }

      const gs1Prefix = await resolveGs1Prefix(tx, organizationId);
      const sscc = gs1Utils.generateSSCC(await nextSsccSerial(tx), gs1Prefix);

      const unit = await tx.logistic_Unit.create({
        data: {
          organization_id: organizationId,
          sscc,
          source: LOGISTIC_UNIT_SOURCES.INTERNAL,
          created_by: userId,
        },
      });

      await tx.logistic_Unit_Content.createMany({
        data: items.map((item) => ({
          id_unite_logistique: unit.id,
          id_lot: item.id_lot,
          quantite: item.quantite,
          unite: byId.get(item.id_lot)!.unite_code,
        })),
      });

      // AggregationEvent à la palettisation, et non à l'expédition : c'est l'instant où le
      // contenant prend son identité et où la relation « ce SSCC porte ces lots » devient vraie.
      await tx.ePCIS_Event.create({
        data: {
          organization_id: organizationId,
          event_time: new Date(),
          event_type: EPCIS_EVENT_TYPE.aggregation,
          related_entity: 'Logistic_Unit',
          related_id: unit.id,
          payload: {
            parentID: gs1Utils.buildSsccUrn(gs1Prefix, sscc),
            childQuantityList: items.map((item) => ({
              epcClass: gs1Utils.buildLgtinUrn(
                gs1Prefix,
                byId.get(item.id_lot)!.produit.code_gtin,
                byId.get(item.id_lot)!.lot_number
              ),
              quantity: item.quantite,
              uom: byId.get(item.id_lot)!.unite_code,
            })),
            action: EPCIS_ACTION.add,
            bizStep: EPCIS_BIZSTEP.packing,
          },
        },
      });

      await auditService.logAction(
        {
          organizationId,
          userId,
          action: 'CREATE_LOGISTIC_UNIT',
          entity: 'Logistic_Unit',
          entityId: unit.id,
          newValue: { sscc, lots: items.map((item) => item.id_lot) },
        },
        tx
      );

      return { id: unit.id, sscc, lots: items.length };
    });
  },

  /**
   * Range une palette : un scan de la palette, un scan de l'emplacement, et ses lots suivent.
   *
   * C'est le geste que le modèle existe pour rendre possible. Ranger douze lots un par un devant un
   * frigo ouvert, gants aux mains, était le geste le plus répétitif du terrain et le plus mal servi.
   *
   * Ce n'est PAS obligatoire : une palette peut n'avoir aucun emplacement — elle attend sur le quai.
   * Et un lot posé dessus reste déplaçable seul ; il quitte alors la palette (cf. `moveBatch`),
   * parce que physiquement il n'est plus dessus.
   *
   * La position vit sur le LOT, jamais sur la palette : c'est exactement ce que filtre la mise en
   * quarantaine froid. Ranger la palette met donc à jour ses lots, et l'excursion suivante les
   * bloque tous sans qu'on ait à reconstituer la liste — le gain réel de cette fonctionnalité.
   *
   * Tout ou rien : si un seul lot ne peut pas suivre, rien ne bouge. Une demi-palette rangée est un
   * mensonge sur l'emplacement de la moitié restante.
   */
  async moveLogisticUnit(
    unitId: string,
    activeOrgId: string,
    userId: string,
    equipmentId: string
  ) {
    return retryableTransaction(async (tx) => {
      const unit = await tx.logistic_Unit.findFirst({
        where: { id: unitId, organization_id: activeOrgId },
        include: {
          contenu: {
            include: {
              lot: {
                select: {
                  id: true,
                  lot_number: true,
                  statut: true,
                  version: true,
                  id_materiel_actuel: true,
                },
              },
            },
          },
        },
      });

      if (!unit) {
        throw new APIError(404, {
          error: [{ field: 'id', message: 'Palette introuvable dans cette organisation' }],
        });
      }

      // La destination est validée AVANT toute autre chose, y compris avant le raccourci
      // d'idempotence : sans cela, une palette déjà en place répondait « Palette rangée. » sur un
      // matériel inexistant, appartenant à une autre organisation, ou sur une cuve.
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
              message: `Une palette se range dans un emplacement de stockage (frigo, congélateur, étagère), pas dans un équipement de type ${equipment.type}.`,
            },
          ],
        });
      }

      // Une palette vide n'est pas « rangée » : elle ne porte plus rien, et la position ne vit que
      // sur les lots. Répondre succès laisserait croire à une traçabilité d'emplacement inexistante.
      if (unit.contenu.length === 0) {
        throw new APIError(409, {
          error: [
            {
              field: 'contenu',
              message: `La palette ${unit.sscc} ne porte plus aucun lot : il n'y a rien à ranger.`,
            },
          ],
        });
      }

      // Gardes sur TOUT le contenu, pas seulement sur les lots à déplacer : un lot sous rappel déjà
      // posé à la destination doit bloquer le geste, sinon le contrat « si un seul lot ne peut pas
      // suivre, rien ne bouge » serait vrai ou faux selon la position initiale des lots.
      for (const contenu of unit.contenu) {
        if (!(MOVABLE_BATCH_STATUSES as readonly string[]).includes(contenu.lot.statut)) {
          throw new APIError(409, {
            error: [
              {
                field: 'contenu',
                // Le message ne conseille PAS « sortez-le d'abord » : un lot sous rappel n'est pas
                // déplaçable seul non plus (`moveBatch` le refuse), donc ce conseil désignait un
                // geste impossible. La seule issue réelle est la décision qualité sur le lot.
                message: `Le lot ${contenu.lot.lot_number} est dans l'état ${contenu.lot.statut} : la palette ne peut pas être rangée tant qu'il la porte. Traitez d'abord le lot (levée de quarantaine ou mise au rebut).`,
              },
            ],
          });
        }
      }

      // Idempotent : un retry réseau d'un rangement réussi ne doit ni rejouer les mouvements ni
      // ajouter un maillon d'audit. Les lots déjà en place ne sont simplement pas retouchés.
      const aDeplacer = unit.contenu.filter((c) => c.lot.id_materiel_actuel !== equipmentId);

      if (aDeplacer.length === 0) {
        return { id: unit.id, sscc: unit.sscc, lots_deplaces: 0, id_materiel: equipmentId };
      }

      const mouvements: Prisma.Batch_MouvementCreateManyInput[] = [];

      for (const contenu of aDeplacer) {
        // Verrou optimiste par lot : si l'état de l'un a changé depuis la lecture, on annule TOUT.
        const updated = await tx.batch.updateMany({
          where: {
            id: contenu.lot.id,
            organization_id: activeOrgId,
            version: contenu.lot.version,
          },
          data: { id_materiel_actuel: equipmentId, version: { increment: 1 } },
        });

        if (updated.count === 0) {
          // La version a bougé, mais pas forcément la position : deux appuis sur le même bouton, ou
          // un retry réseau, font aboutir le premier et échouer le second alors que TOUT a réussi.
          // On relit donc l'état frais avant d'alarmer, et on rejoue la garde de statut complète —
          // un rappel intercalé change la version sans toucher la position, et scellerait sinon un
          // maillon d'audit affirmant qu'on a rangé un lot devenu intouchable.
          const frais = await tx.batch.findFirst({
            where: { id: contenu.lot.id, organization_id: activeOrgId },
            select: { statut: true, id_materiel_actuel: true },
          });

          const dejaEnPlace =
            frais?.id_materiel_actuel === equipmentId &&
            (MOVABLE_BATCH_STATUSES as readonly string[]).includes(frais.statut);

          if (!dejaEnPlace) {
            throw new APIError(409, {
              error: [
                {
                  field: 'contenu',
                  message: `L'état du lot ${contenu.lot.lot_number} a changé pendant le rangement. Rechargez la palette avant de réessayer.`,
                },
              ],
            });
          }

          continue;
        }

        mouvements.push({
          id_lot: contenu.lot.id,
          type_action: MOVEMENT_TYPES.MOVE,
          // La quantité du MOUVEMENT est celle qui est sur CETTE palette, pas le stock total du
          // lot : un lot réparti sur deux palettes verrait sinon ses 800 kg déplacés deux fois
          // dans sa frise, alors que 300 seulement ont bougé.
          quantite: contenu.quantite,
          unite: contenu.unite,
          id_user: userId,
          // Le SSCC dans le mouvement : la frise du lot doit dire qu'il a bougé PARCE QUE sa
          // palette a été rangée, et non par un geste individuel.
          metadata: {
            from: contenu.lot.id_materiel_actuel,
            to: equipmentId,
            sscc: unit.sscc,
          },
        });
      }

      // Écriture groupée : la boucle faisait deux allers-retours par lot, soit jusqu'à 200 pour les
      // 100 lots que la validation autorise — et la transaction porte aussi la chaîne d'audit, qui
      // se sérialise par organisation. Moins elle dure, moins elle bloque les scans concurrents.
      // Rien n'a bougé : une course a fait aboutir un geste identique juste avant. Le raccourci
      // d'idempotence plus haut promet qu'un retry n'ajoute pas de maillon d'audit — sortir ici tient
      // la même promesse sur ce chemin-là, au lieu de sceller un « rangement de zéro lot » dans une
      // chaîne WORM qui se sérialise déjà par organisation.
      if (mouvements.length === 0) {
        return { id: unit.id, sscc: unit.sscc, lots_deplaces: 0, id_materiel: equipmentId };
      }

      await tx.batch_Mouvement.createMany({ data: mouvements });

      // UN maillon d'audit pour le geste, pas un par lot : ranger une palette est une seule
      // décision, et les écritures d'audit d'une organisation se sérialisent sur une chaîne
      // unique — douze maillons pour un scan renchériraient la contention sans rien prouver de
      // plus. La trace par lot existe, c'est le mouvement.
      await auditService.logAction(
        {
          organizationId: activeOrgId,
          userId,
          action: 'MOVE_LOGISTIC_UNIT',
          entity: 'Logistic_Unit',
          entityId: unit.id,
          newValue: {
            sscc: unit.sscc,
            id_materiel: equipmentId,
            lots: mouvements.map((mouvement) => mouvement.id_lot),
          },
        },
        tx
      );

      return {
        id: unit.id,
        sscc: unit.sscc,
        lots_deplaces: mouvements.length,
        id_materiel: equipmentId,
      };
    }, MOVE_TRANSACTION_OPTIONS);
  },

  /**
   * Résout un SSCC scanné vers sa palette et son contenu.
   *
   * Cloisonnée par organisation : une palette expose des produits, des quantités et l'état
   * sanitaire de ce qu'elle porte.
   */
  async resolveBySscc(sscc: string, organizationId: string) {
    const unit = await prisma.logistic_Unit.findFirst({
      where: { sscc, organization_id: organizationId },
      include: CONTENT_INCLUDE,
    });

    if (!unit) {
      throw new APIError(404, {
        error: [{ field: 'sscc', message: 'Palette introuvable dans cette organisation' }],
      });
    }

    const lots = unit.contenu.map((content) => ({
      id: content.lot.id,
      numero_lot: content.lot.lot_number,
      produit: content.lot.produit.nom,
      gtin: content.lot.produit.code_gtin,
      quantite: Number(content.quantite),
      unite: content.unite,
      statut: content.lot.statut,
      date_peremption: content.lot.date_peremption,
    }));

    // La palette ne porte pas de position : elle se déduit de ses lots. Après avoir rangé, un
    // rescan du SSCC doit dire OÙ elle est, sinon l'opérateur n'a aucun moyen de vérifier son
    // geste. Si les lots divergent, on ne choisit pas — on le signale.
    const positions = new Set(unit.contenu.map((content) => content.lot.id_materiel_actuel));
    const positionsDivergentes = positions.size > 1;
    const position = positionsDivergentes ? null : ([...positions][0] ?? null);

    return {
      id: unit.id,
      sscc: unit.sscc,
      source: unit.source,
      created_at: unit.created_at,
      id_materiel: position,
      positions_divergentes: positionsDivergentes,
      // Un lot peut passer en rappel APRÈS la palettisation : c'est précisément ce que le scan
      // doit révéler sur le quai, sinon le rappel reste une notification et ne devient jamais un
      // geste.
      contient_lot_rappele: lots.some((lot) => lot.statut === BATCH_STATUSES.ALERT),
      lots,
    };
  },
};
