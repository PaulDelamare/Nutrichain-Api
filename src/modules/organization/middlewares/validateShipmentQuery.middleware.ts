import { Response, NextFunction } from 'express';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { shipmentQuerySchema } from './shipmentQuery.schema';

export const validateShipmentQuery = catchAsync(
  async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    req.validatedShipmentQuery = await validateData(shipmentQuerySchema, req.query);
    next();
  }
);
