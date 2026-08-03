import { Response, NextFunction } from 'express';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { equipmentQuerySchema } from './equipmentQuery.schema';

export const validateEquipmentQuery = catchAsync(
  async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    req.validatedEquipmentQuery = await validateData(equipmentQuerySchema, req.query);
    next();
  }
);
