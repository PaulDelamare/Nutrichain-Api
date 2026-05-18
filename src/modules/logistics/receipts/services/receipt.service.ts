import { prisma } from '../../../../shared/configs/prismaClient.config';

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

export const receiptService = {
  /**
   * Action métier critique : Crée l'historique de réception GS1 et le lot NutriChain
   */
  async createReceipt(data: CreateReceiptData) {
    return prisma.$transaction(async (tx) => {
      // Vérifier l'existence des références pour éviter les erreurs P2003
      // 🔒 SÉCURITÉ : On filtre par organization_id pour éviter de confirmer l'existence de ressources concurrentes
      const supplier = await tx.supplier.findFirst({
        where: { id: data.id_fournisseur, organization_id: data.organization_id },
      });
      if (!supplier)
        throw {
          status: 404,
          error: [
            { field: 'id_fournisseur', message: 'Fournisseur introuvable dans cette organisation' },
          ],
        };

      const product = await tx.product.findFirst({
        where: { id: data.id_produit, organization_id: data.organization_id },
      });
      if (!product)
        throw {
          status: 404,
          error: [{ field: 'id_produit', message: 'Produit introuvable dans cette organisation' }],
        };

      // L'utilisateur doit exister globalement mais être membre de l'org (Optionnel selon business rule, ici on garde findUnique pour l'user)
      const user = await tx.user.findUnique({ where: { id: data.received_by } });
      if (!user)
        throw {
          status: 404,
          error: [{ field: 'received_by', message: 'Utilisateur introuvable' }],
        };

      // Vérifier l'unité (Globalement partagée dans le système GS1/ISO)
      if (data.unite_code) {
        const unit = await tx.unit.findUnique({ where: { code: data.unite_code } });
        if (!unit)
          throw { status: 400, error: [{ field: 'unite_code', message: 'Unité inconnue' }] };
      }

      // 1. Trace logistique physique (Le bon de réception)
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

      // 2. Création du contenant numérique traçable (Le Batch/Lot interne)
      const batch = await tx.batch.create({
        data: {
          organization_id: data.organization_id,
          id_produit: data.id_produit,
          quantite_actuelle: data.quantite_actuelle,
          unite_code: data.unite_code,
          quantite_base: data.quantite_actuelle,
          statut: 'EN_STOCK',
          created_by: data.received_by,
        },
      });

      return {
        message: 'Réception enregistrée avec succès et Lot généré.',
        receiptId: receipt.id,
        batchId: batch.id,
      };
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
      throw { status: 404, error: [{ field: 'receipt', message: 'Réception introuvable' }] };
    }
    return receipt;
  },

  /**
   * Récupérer un lot par son ID
   * Note: La sécurité multi-tenant est renforcée par activeOrgId en plus du middleware
   */
  async getBatchById(id: string, activeOrgId: string) {
    const batch = await prisma.batch.findFirst({
      where: { id, organization_id: activeOrgId },
      include: { produit: true, unite: true },
    });

    if (!batch) {
      throw { status: 404, error: [{ field: 'batch', message: 'Lot introuvable' }] };
    }
    return batch;
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
