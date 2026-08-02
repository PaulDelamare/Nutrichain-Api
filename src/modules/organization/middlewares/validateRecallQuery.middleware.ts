import { Response, NextFunction } from 'express';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { recallQuerySchema } from './recallQuery.schema';

export const validateRecallQuery = catchAsync(
  async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    req.validatedRecallQuery = await validateData(recallQuerySchema, req.query);
    next();
  }
);
