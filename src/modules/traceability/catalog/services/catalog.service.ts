import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const catalogService = {
  /**
   * Récupère la liste de tous les produits au catalogue
   */
  async getAllProducts() {
    return await prisma.product.findMany({
      orderBy: { nom: 'asc' },
    });
  },

  /**
   * Récupère la liste de tous les lots (batches) en cours de suivi
   */
  async getAllBatches() {
    return await prisma.batch.findMany({
      include: {
        produit: { select: { nom: true, code_gtin: true } },
        unite: { select: { nom: true } },
        user: { select: { name: true, email: true } },
      },
      orderBy: { date_creation: 'desc' },
    });
  },
};
