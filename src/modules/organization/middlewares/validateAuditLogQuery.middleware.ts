import { Response, NextFunction } from 'express';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { auditLogQuerySchema } from './auditLogQuery.schema';

export const validateAuditLogQuery = catchAsync(
  async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    req.validatedAuditLogQuery = await validateData(auditLogQuerySchema, req.query);
    next();
  }
);
