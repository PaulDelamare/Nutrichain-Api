import { Response } from 'express';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../../shared/utils/returnSuccess/returnSuccess';
import { catalogService } from '../services/catalog.service';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';
import { resolveActiveOrgId } from '../../../identity/utils/resolveActiveOrgId';

export const getProducts = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const activeOrgId = await resolveActiveOrgId(req);

  const products = await catalogService.getAllProducts(activeOrgId);
  sendSuccess(res, 200, 'Produits récupérés avec succès', products);
});

export const getBatches = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const activeOrgId = await resolveActiveOrgId(req);

  const batches = await catalogService.getAllBatches(activeOrgId);
  sendSuccess(res, 200, 'Lots récupérés avec succès', batches);
});
