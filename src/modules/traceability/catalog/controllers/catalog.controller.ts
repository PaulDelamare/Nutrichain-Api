import { Response } from 'express';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../../shared/utils/returnSuccess/returnSuccess';
import { catalogService } from '../services/catalog.service';
import { AuthenticatedRequest } from '../../../identity/middlewares/requireAuth.middleware';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

export const getProducts = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const activeOrgId = req.activeOrgId || req.auth?.activeOrgId;

  if (!activeOrgId) {
    throw new APIError(400, {
      error: [{ field: 'organization', message: 'Organisation active non identifiée.' }],
    });
  }

  const products = await catalogService.getAllProducts(activeOrgId);
  sendSuccess(res, 200, 'Produits récupérés avec succès', products);
});

export const getBatches = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const activeOrgId = req.activeOrgId || req.auth?.activeOrgId;
  const { q } = req.query;

  if (!activeOrgId) {
    throw new APIError(400, {
      error: [{ field: 'organization', message: 'Organisation active non identifiée.' }],
    });
  }

  const batches = await catalogService.getAllBatches(activeOrgId, q as string);
  sendSuccess(res, 200, 'Lots récupérés avec succès', batches);
});
