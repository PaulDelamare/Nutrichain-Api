import { Request, Response } from 'express';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../../shared/utils/returnSuccess/returnSuccess';
import { catalogService } from '../services/catalog.service';

export const getProducts = catchAsync(async (req: Request, res: Response) => {
  const products = await catalogService.getAllProducts();
  sendSuccess(res, 200, 'Produits récupérés avec succès', products);
});

export const getBatches = catchAsync(async (req: Request, res: Response) => {
  const batches = await catalogService.getAllBatches();
  sendSuccess(res, 200, 'Lots récupérés avec succès', batches);
});
