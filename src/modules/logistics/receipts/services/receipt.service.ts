import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { batchService } from '../../shared/services/batch.service';
import { auditService } from '../../../../shared/utils/audit/audit.service';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

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

  const batch = await batchService.createBatch(tx, {
    organization_id: data.organization_id,
    id_produit: data.id_produit,
    quantite_actuelle: data.quantite_actuelle,
    unite_code: data.unite_code,
    created_by: data.received_by,
  });

  // Événement EPCIS ObjectEvent : entrée du lot dans la chaîne lors de la réception (interopérabilité GS1)
  await tx.ePCIS_Event.create({
    data: {
      organization_id: data.organization_id,
      event_time: new Date(),
      event_type: 'ObjectEvent',
      related_entity: 'Receipt',
      related_id: receipt.id,
      payload: {
        epcList: [batch.id],
        action: 'ADD',
        bizStep: 'urn:epcglobal:cbv:bizstep:receiving',
        disposition: 'urn:epcglobal:cbv:disp:active',
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
  async getBatchById(id: string, activeOrgId: string) {
    return batchService.getBatchById(id, activeOrgId);
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
