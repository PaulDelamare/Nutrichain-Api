import { Response, NextFunction } from 'express';
import { validateData } from '../../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';
import { scrapSchema } from './scrap.schema';

/**
 * Validation du motif de mise au rebut (Fail Fast, avant le contrôleur).
 */
export const validateScrap = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    req.validatedScrap = await validateData(scrapSchema, req.body);
    next();
  }
);
