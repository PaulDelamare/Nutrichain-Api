import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { batchService, type CreateBatchInput } from '../../shared/services/batch.service';
import { auditService } from '../../../../shared/utils/audit/audit.service';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import {
  EPCIS_ACTION,
  EPCIS_BIZSTEP,
  EPCIS_DISPOSITION,
  EPCIS_EVENT_TYPE,
  EPCIS_RELATED_ENTITY,
} from '../../../../shared/constants/epcis.constants';
import { gs1Utils } from '../../../../shared/utils/gs1/gs1.utils';
import { resolveGs1Prefix } from '../../../../shared/utils/gs1/gs1Prefix';
import {
  BATCH_STATUSES,
  MOVEMENT_TYPES,
  QUARANTINE_RECEIPT_CONTROLS,
} from '../../constants/logistics.constants';

/**
 * Interface pour les données de création d'une réception.
 */
export interface CreateReceiptData {
  organization_id: string;
  id_fournisseur: string;
  id_produit: string;
  shipment_id: string;
  statut_controle: string;
  received_by: string;
  quantite_actuelle: number;
  unite_code: string;
  /** Emplacement de stockage (matériel) où le lot reçu est rangé — optionnel. */
  id_materiel?: string;
  /** Numéro de lot lu sur l'étiquette du fournisseur (GS1 AI 10). */
  lot_number?: string;
  /** DLC lue sur l'étiquette (GS1 AI 17), au format `YYYY-MM-DD`. */
  date_peremption?: string;
}

/**
 * Une DLC est un JOUR, et « à consommer jusqu'au 20/07 » veut dire le 20/07 INCLUS. Les gardes
 * « lot périmé » (expédition, transformation) comparent `date_peremption < new Date()` : ancrée à
 * minuit, une DLC au 20/07 rendrait le lot inexpédiable dès 00h01 ce jour-là — un jour de vie perdu
 * sur CHAQUE lot, et un lot reçu avec une DLC du jour serait mort-né. On ancre donc à la fin de la
 * journée. (Ce n'est pas une question de fuseau : `new Date('2026-07-20')` est déjà parsé en UTC.)
 */
function toEndOfUtcDay(isoDay: string): Date {
  return new Date(`${isoDay}T23:59:59.999Z`);
}

/**
 * `YYYY-MM-DD` bien formé ne veut pas dire jour existant : `2026-02-30` est accepté par le regex,
 * puis Date le REPORTE au 2 mars — une DLC allongée de deux jours, en silence, sur une donnée
 * sanitaire. On exige donc que la date relise à l'identique, et qu'elle ne soit pas déjà passée.
 */
function parseExpiryDay(isoDay: string): Date {
  const expiry = toEndOfUtcDay(isoDay);

  if (Number.isNaN(expiry.getTime()) || expiry.toISOString().slice(0, 10) !== isoDay) {
    throw new APIError(400, {
      error: [{ field: 'date_peremption', message: `Date de péremption inexistante : ${isoDay}.` }],
    });
  }

  if (expiry.getTime() < Date.now()) {
    throw new APIError(400, {
      error: [
        { field: 'date_peremption', message: `Ce lot est déjà périmé (DLC au ${isoDay}).` },
      ],
    });
  }

  return expiry;
}

/** DLC de repli quand l'étiquette n'en porte pas : la durée de conservation du produit. */
function shelfLifeFrom(product: { duree_conservation_defaut: number }): Date | undefined {
  // Une durée nulle ou négative ferait naître le lot périmé, donc immédiatement inexpédiable.
  // Mieux vaut pas de DLC du tout qu'une DLC fausse.
  if (!(product.duree_conservation_defaut > 0)) {
    return undefined;
  }

  const expiry = new Date();
  expiry.setUTCDate(expiry.getUTCDate() + product.duree_conservation_defaut);
  expiry.setUTCHours(23, 59, 59, 999);
  return expiry;
}

/**
 * `@@unique([organization_id, lot_number])` fait déjà barrage au doublon en base ; sans traduction,
 * l'opérateur reçoit un 500 illisible. Le bon geste, lui, n'est pas de réceptionner à nouveau :
 * c'est d'ouvrir la fiche du lot déjà reçu.
 */
async function createBatchOrRejectDuplicate(
  tx: Prisma.TransactionClient,
  input: CreateBatchInput
) {
  try {
    return await batchService.createBatch(tx, input);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      input.lot_number
    ) {
      throw new APIError(409, {
        error: [
          {
            field: 'lot_number',
            message: `Le lot ${input.lot_number} a déjà été reçu dans cette organisation.`,
          },
        ],
      });
    }
    throw error;
  }
}

/**
 * Logique métier de création d'un Receipt + Batch + audit, exécutée dans un client
 * de transaction Prisma. Extrait pour permettre l'imbrication dans une tx externe
 * (utilisé par le module sync pour atomicité avec l'idempotency key).
 */
async function createReceiptInTx(tx: Prisma.TransactionClient, data: CreateReceiptData) {
  const supplier = await tx.supplier.findFirst({
    where: { id: data.id_fournisseur, organization_id: data.organization_id },
  });
  if (!supplier) {
    throw new APIError(404, {
      error: [{ field: 'id_fournisseur', message: 'Fournisseur introuvable ou accès refusé' }],
    });
  }

  const product = await tx.product.findFirst({
    where: { id: data.id_produit, organization_id: data.organization_id },
  });
  if (!product) {
    throw new APIError(404, {
      error: [{ field: 'id_produit', message: 'Produit introuvable ou accès refusé' }],
    });
  }

  const gs1Prefix = await resolveGs1Prefix(tx, data.organization_id);

  const user = await tx.user.findUnique({ where: { id: data.received_by } });
  if (!user) {
    throw new APIError(404, {
      error: [{ field: 'received_by', message: 'Utilisateur introuvable' }],
    });
  }

  if (data.unite_code) {
    const unit = await tx.unit.findUnique({ where: { code: data.unite_code } });
    if (!unit) {
      throw new APIError(400, { error: [{ field: 'unite_code', message: 'Unité inconnue' }] });
    }
  }

  // Emplacement de stockage : on vérifie que le matériel appartient à l'organisation
  // (garde cross-tenant) avant de rattacher le lot à sa position.
  if (data.id_materiel) {
    const equipment = await tx.equipment.findFirst({
      where: { id: data.id_materiel, organization_id: data.organization_id },
    });
    if (!equipment) {
      throw new APIError(404, {
        error: [
          { field: 'id_materiel', message: 'Matériel de stockage introuvable ou accès refusé' },
        ],
      });
    }
  }

  const receipt = await tx.receipt.create({
    data: {
      organization_id: data.organization_id,
      id_fournisseur: data.id_fournisseur,
      shipment_id: data.shipment_id,
      date_reception: new Date(),
      statut_controle: data.statut_controle,
      received_by: data.received_by,
    },
  });

  // Sûreté sanitaire HACCP : un lot reçu non-conforme (ou en alerte) est créé en
  // quarantaine (BLOQUE), ce qui interdit sa transformation et son expédition tant
  // qu'une décision qualité ne l'a pas levé. Sinon il entre en stock normalement.
  const isQuarantined = QUARANTINE_RECEIPT_CONTROLS.includes(data.statut_controle);

  // Sans DLC, la garde « lot périmé » du reste du système est du code mort : jusqu'ici, 100 % des
  // lots réels naissaient sans date (seuls ceux du seed en avaient, ce qui masquait le trou).
  const datePeremption = data.date_peremption
    ? parseExpiryDay(data.date_peremption)
    : shelfLifeFrom(product);

  const batch = await createBatchOrRejectDuplicate(tx, {
    organization_id: data.organization_id,
    id_produit: data.id_produit,
    quantite_actuelle: data.quantite_actuelle,
    unite_code: data.unite_code,
    created_by: data.received_by,
    // Casse normalisée : sans ça, `abc123` et `ABC123` sont deux lots distincts pour la contrainte
    // d'unicité — la même palette serait réceptionnée deux fois selon la façon dont on la saisit.
    lot_number: data.lot_number?.toUpperCase(),
    date_peremption: datePeremption,
    statut: isQuarantined ? BATCH_STATUSES.BLOCKED : BATCH_STATUSES.IN_STOCK,
    id_materiel_actuel: data.id_materiel,
  });

  // Premier maillon de l'historique du lot. Sans lui, un lot reçu et jamais transformé
  // n'a AUCUNE trace de son arrivée : sa frise commence dans le vide.
  await tx.batch_Mouvement.create({
    data: {
      id_lot: batch.id,
      type_action: MOVEMENT_TYPES.RECEPTION,
      quantite: data.quantite_actuelle,
      unite: data.unite_code,
      id_user: data.received_by,
      metadata: {
        id_receipt: receipt.id,
        id_fournisseur: data.id_fournisseur,
        statut_controle: data.statut_controle,
        quarantaine: isQuarantined,
      },
    },
  });

  // Événement EPCIS ObjectEvent : entrée du lot dans la chaîne lors de la réception.
  // Identification GS1 de niveau classe (URN LGTIN) : un lot n'est pas une instance
  // sérialisée, il est donc porté dans quantityList avec sa quantité.
  await tx.ePCIS_Event.create({
    data: {
      organization_id: data.organization_id,
      event_time: new Date(),
      event_type: EPCIS_EVENT_TYPE.object,
      related_entity: EPCIS_RELATED_ENTITY.receipt,
      related_id: receipt.id,
      payload: {
        quantityList: [
          {
            epcClass: gs1Utils.buildLgtinUrn(gs1Prefix, product.code_gtin, batch.lot_number),
            quantity: data.quantite_actuelle,
            uom: data.unite_code,
          },
        ],
        action: EPCIS_ACTION.add,
        bizStep: EPCIS_BIZSTEP.receiving,
        disposition: EPCIS_DISPOSITION.active,
        sourceParty: data.id_fournisseur,
      },
    },
  });

  await auditService.logAction(
    {
      organizationId: data.organization_id,
      userId: data.received_by,
      action: 'CREATE_RECEIPT',
      entity: 'Receipt',
      entityId: receipt.id,
      newValue: receipt as unknown as Record<string, unknown>,
    },
    tx
  );

  return {
    message: 'Réception enregistrée avec succès et Lot généré.',
    receiptId: receipt.id,
    batchId: batch.id,
  };
}

export const receiptService = {
  /**
   * Crée un Receipt + Batch + audit dans une transaction.
   * Si `externalTx` est fourni, la création se fait DANS cette transaction (pas de tx imbriquée).
   * Sinon, ouvre sa propre transaction Serializable.
   */
  async createReceipt(data: CreateReceiptData, externalTx?: Prisma.TransactionClient) {
    if (externalTx) {
      return createReceiptInTx(externalTx, data);
    }
    return prisma.$transaction((tx) => createReceiptInTx(tx, data), {
      timeout: 30000,
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  },

  /**
   * Récupérer une réception par son ID
   * Note: La sécurité multi-tenant est renforcée par activeOrgId en plus du middleware
   */
  async getReceiptById(id: string, activeOrgId: string) {
    const receipt = await prisma.receipt.findFirst({
      where: { id, organization_id: activeOrgId },
      include: { fournisseur: true },
    });

    if (!receipt) {
      throw new APIError(404, {
        error: [{ field: 'receipt', message: 'Réception introuvable' }],
      });
    }
    return receipt;
  },

  /**
   * Récupérer un lot par son ID
   * Note: La sécurité multi-tenant est déléguée au batchService
   */
  async getBatchById(id: string, activeOrgId: string, revealAuthor = false) {
    return batchService.getBatchById(id, activeOrgId, revealAuthor);
  },

  /**
   * Lister les réceptions filtrées par organisation
   */
  async listReceipts(activeOrgId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [total, receipts] = await prisma.$transaction([
      prisma.receipt.count({ where: { organization_id: activeOrgId } }),
      prisma.receipt.findMany({
        where: { organization_id: activeOrgId },
        include: { fournisseur: true },
        orderBy: { date_reception: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: receipts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  /**
   * Statistiques pour le Dashboard du réceptionneur
   */
  async getReceiptStats(activeOrgId: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const count = await prisma.receipt.count({
      where: {
        organization_id: activeOrgId,
        date_reception: { gte: startOfDay },
      },
    });

    return {
      total_receipts_today: count,
      total_quantity_kg: 0, // Idéalement via un aggregate Prisma
    };
  },
};
