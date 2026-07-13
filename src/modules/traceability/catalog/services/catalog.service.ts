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
  async getAllBatches(organization_id: string, search?: string, revealAuthor = false) {
    return await prisma.batch.findMany({
      where: {
        organization_id,
        OR: search
          ? [
              { id: { contains: search, mode: 'insensitive' } },
              { produit: { nom: { contains: search, mode: 'insensitive' } } },
              { statut: { contains: search, mode: 'insensitive' } },
            ]
          : undefined,
      },
      include: {
        produit: { select: { nom: true, code_gtin: true } },
        unite: { select: { nom: true } },
        // Le nom ET l'e-mail de l'auteur du lot ne sont joints que pour l'administration : c'est une
        // donnée personnelle, inutile à un opérateur qui consulte le catalogue.
        ...(revealAuthor ? { user: { select: { name: true, email: true } } } : {}),
        // Emplacement de stockage (matériel → lieu) : permet de connaître la position du lot.
        materiel: { select: { nom: true, lieu: { select: { nom: true } } } },
      },
      orderBy: { date_creation: 'desc' },
      take: 100, // Limite de sécurité pour éviter les listes infinies
    });
  },
};
