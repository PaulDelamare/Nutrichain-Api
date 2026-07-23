import { Response, NextFunction } from 'express';
import { validateData } from '../../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';
import { moveBatchSchema } from './moveBatch.schema';

/**
 * Validation du matériel cible d'un déplacement de lot (Fail Fast, avant le contrôleur).
 */
export const validateMoveBatch = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    req.validatedMoveBatch = await validateData(moveBatchSchema, req.body);
    next();
  }
);
