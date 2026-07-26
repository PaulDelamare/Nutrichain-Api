import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { CATALOG_PAGE_DEFAULTS } from '../middlewares/catalogQuery.schema';

export const catalogService = {
  /**
   * Récupère la liste de tous les produits au catalogue d'une organisation
   */
  // Actifs seulement par défaut : un produit archivé ne doit plus être proposé (réception, production).
  async getAllProducts(organization_id: string, includeArchived = false) {
    return await prisma.product.findMany({
      where: includeArchived ? { organization_id } : { organization_id, is_active: true },
      orderBy: { nom: 'asc' },
    });
  },

  /**
   * Récupère la page demandée des lots (batches) en cours de suivi.
   *
   * Le `total` compte TOUS les lots correspondants, pas seulement ceux de la page : sans lui,
   * l'appelant ne peut pas distinguer « il n'y a que 100 lots » de « on t'en montre 100 ».
   */
  async getAllBatches(
    organization_id: string,
    options: {
      search?: string;
      page?: number;
      limit?: number;
      revealAuthor?: boolean;
    } = {}
  ) {
    const {
      search,
      page = CATALOG_PAGE_DEFAULTS.page,
      limit = CATALOG_PAGE_DEFAULTS.limit,
      revealAuthor = false,
    } = options;

    const where: Prisma.BatchWhereInput = {
      organization_id,
      // `lot_number` et le GTIN sont ce que l'opérateur LIT sur l'étiquette : chercher le numéro
      // affiché à l'écran précédent ne renvoyait rien tant qu'ils manquaient ici.
      OR: search
        ? [
            { lot_number: { contains: search, mode: 'insensitive' } },
            { id: { contains: search, mode: 'insensitive' } },
            { produit: { nom: { contains: search, mode: 'insensitive' } } },
            { produit: { code_gtin: { contains: search, mode: 'insensitive' } } },
            { statut: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [total, batches] = await prisma.$transaction([
      prisma.batch.count({ where }),
      prisma.batch.findMany({
        where,
        include: {
          produit: { select: { nom: true, code_gtin: true } },
          unite: { select: { nom: true } },
          // Le nom ET l'e-mail de l'auteur du lot ne sont joints que pour l'administration : c'est une
          // donnée personnelle, inutile à un opérateur qui consulte le catalogue.
          ...(revealAuthor ? { user: { select: { name: true, email: true } } } : {}),
          // Emplacement de stockage (matériel → lieu) : permet de connaître la position du lot.
          // Les coordonnées suivent le nom pour que la fiche lot servie depuis le catalogue place le
          // même repère que celle servie par `getBatchById` — sinon la carte apparaît selon le chemin.
          materiel: {
            select: {
              nom: true,
              lieu: { select: { nom: true, latitude: true, longitude: true } },
            },
          },
        },
        orderBy: { date_creation: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: batches,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },
};
