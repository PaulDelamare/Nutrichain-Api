import { Response, NextFunction } from 'express';
import { validateData } from '../../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';
import { quarantineLiftSchema } from './quarantineLift.schema';

/**
 * Validation du motif de levée de quarantaine (Fail Fast, avant le contrôleur).
 */
export const validateQuarantineLift = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    req.validatedQuarantineLift = await validateData(quarantineLiftSchema, req.body);
    next();
  }
);
