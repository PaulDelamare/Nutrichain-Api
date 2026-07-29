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
import { BATCH_STATUSES, PALLETIZABLE_BATCH_STATUSES } from '../../constants/logistics.constants';

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
          produit: { select: { nom: true, code_gtin: true } },
        },
      },
    },
  },
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

    return {
      id: unit.id,
      sscc: unit.sscc,
      source: unit.source,
      created_at: unit.created_at,
      // Un lot peut passer en rappel APRÈS la palettisation : c'est précisément ce que le scan
      // doit révéler sur le quai, sinon le rappel reste une notification et ne devient jamais un
      // geste.
      contient_lot_rappele: lots.some((lot) => lot.statut === BATCH_STATUSES.ALERT),
      lots,
    };
  },
};
