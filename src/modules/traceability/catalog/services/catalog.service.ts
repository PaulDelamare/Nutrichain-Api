import { prisma } from '../../../../shared/configs/prismaClient.config';

export const catalogService = {
  /**
   * Récupère la liste de tous les produits au catalogue d'une organisation
   */
  async getAllProducts(organization_id: string) {
    return await prisma.product.findMany({
      where: { organization_id },
      orderBy: { nom: 'asc' },
    });
  },

  /**
   * Récupère la liste de tous les lots (batches) en cours de suivi
   */
  async getAllBatches(organization_id: string) {
    return await prisma.batch.findMany({
      where: { organization_id },
      include: {
        produit: { select: { nom: true, code_gtin: true } },
        unite: { select: { nom: true } },
        user: { select: { name: true, email: true } },
      },
      orderBy: { date_creation: 'desc' },
    });
  },
};
