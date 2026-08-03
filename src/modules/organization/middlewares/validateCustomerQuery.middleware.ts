import { Response, NextFunction } from 'express';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { customerQuerySchema } from './customerQuery.schema';

export const validateCustomerQuery = catchAsync(
  async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    req.validatedCustomerQuery = await validateData(customerQuerySchema, req.query);
    next();
  }
);
