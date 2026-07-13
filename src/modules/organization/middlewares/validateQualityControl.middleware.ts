import { Response, NextFunction } from 'express';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { createQualityControlSchema } from './qualityControl.schema';

export const validateCreateQualityControl = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    req.validatedQualityControl = await validateData(createQualityControlSchema, req.body);

    next();
  }
);
