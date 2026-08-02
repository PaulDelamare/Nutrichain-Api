import { Response } from 'express';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../../shared/utils/returnSuccess/returnSuccess';
import { catalogService } from '../services/catalog.service';
import { AuthenticatedRequest } from '../../../identity/middlewares/requireAuth.middleware';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { ADMIN_ROLES, type Role } from '../../../identity/constants/roles.constants';
import { CATALOG_PAGE_DEFAULTS } from '../middlewares/catalogQuery.schema';

export const getProducts = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const activeOrgId = req.activeOrgId || req.auth?.activeOrgId;

  if (!activeOrgId) {
    throw new APIError(400, {
      error: [{ field: 'organization', message: 'Organisation active non identifiée.' }],
    });
  }

  // Voir les archivés est un usage d'administration (réactiver) : un rôle en lecture ne les énumère pas.
  const includeArchived =
    req.query.includeArchived === 'true' &&
    (ADMIN_ROLES as string[]).includes(req.auth?.role ?? '');

  const products = await catalogService.getAllProducts(activeOrgId, includeArchived);
  sendSuccess(res, 200, 'Produits récupérés avec succès', products);
});

export const getBatches = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const activeOrgId = req.activeOrgId || req.auth?.activeOrgId;
  // Validé en amont : `?q=a&q=b` donnait un TABLEAU transmis au `contains` de Prisma (500).
  const {
    q,
    page = CATALOG_PAGE_DEFAULTS.page,
    limit = CATALOG_PAGE_DEFAULTS.limit,
    statut,
    produit,
    site,
    lot,
    gtin,
  } = req.validatedCatalogQuery ?? {};

  if (!activeOrgId) {
    throw new APIError(400, {
      error: [{ field: 'organization', message: 'Organisation active non identifiée.' }],
    });
  }

  const revealAuthor = ADMIN_ROLES.includes(req.auth?.role as Role);
  const batches = await catalogService.getAllBatches(activeOrgId, {
    search: q,
    page,
    limit,
    statut,
    produit,
    site,
    lot,
    gtin,
    revealAuthor,
  });
  sendSuccess(res, 200, 'Lots récupérés avec succès', batches);
});
