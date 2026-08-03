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

  // Chemin paginé de l'écran Configuration (le tableau + ses filtres). `getAllProducts` ci-dessus
  // reste pour les sélecteurs de l'app, qui n'envoient pas de `page`.
  //
  // `includeArchived` traduit le droit (administration) de voir les produits retirés : sans lui, le
  // filtre `statut` est ignoré et la liste reste bornée aux actifs — un rôle en lecture ne peut pas
  // énumérer ce qui a été archivé, même en forçant `?page=1&statut=archive`.
  async getProductsPaginated(
    organization_id: string,
    options: {
      page?: number;
      limit?: number;
      nom?: string;
      gtin?: string;
      statut?: 'actif' | 'archive';
      includeArchived?: boolean;
    } = {}
  ) {
    const { page = 1, limit = 20, nom, gtin, statut, includeArchived = false } = options;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
      organization_id,
      nom: nom ? { contains: nom, mode: 'insensitive' } : undefined,
      code_gtin: gtin ? { contains: gtin, mode: 'insensitive' } : undefined,
      is_active: !includeArchived
        ? true
        : statut === 'actif'
          ? true
          : statut === 'archive'
            ? false
            : undefined,
    };

    const [total, data] = await prisma.$transaction([
      prisma.product.count({ where }),
      prisma.product.findMany({ where, orderBy: { nom: 'asc' }, skip, take: limit }),
    ]);

    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
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
      // Filtres de colonnes appliqués dans la requête (et non plus sur la page reçue) : chacun
      // restreint sur TOUTE l'organisation. Absents (undefined) ⇒ Prisma les ignore.
      statut?: string;
      produit?: string;
      site?: string;
      lot?: string;
      gtin?: string;
      revealAuthor?: boolean;
    } = {}
  ) {
    const {
      search,
      page = CATALOG_PAGE_DEFAULTS.page,
      limit = CATALOG_PAGE_DEFAULTS.limit,
      statut,
      produit,
      site,
      lot,
      gtin,
      revealAuthor = false,
    } = options;

    const where: Prisma.BatchWhereInput = {
      organization_id,
      // Filtres de colonnes (ET) : Prisma ignore les clés `undefined`, donc un filtre non fourni
      // ne restreint rien. `site` filtre sur l'emplacement du matériel qui stocke le lot.
      statut: statut || undefined,
      id_produit: produit || undefined,
      materiel: site ? { id_lieu: site } : undefined,
      lot_number: lot ? { contains: lot, mode: 'insensitive' } : undefined,
      produit: gtin ? { code_gtin: { contains: gtin, mode: 'insensitive' } } : undefined,
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
