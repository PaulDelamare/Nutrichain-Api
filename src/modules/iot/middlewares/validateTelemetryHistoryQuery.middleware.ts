import { Response, NextFunction } from 'express';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { telemetryHistoryQuerySchema } from './telemetryHistoryQuery.schema';

export const validateTelemetryHistoryQuery = catchAsync(
  async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    req.validatedTelemetryHistoryQuery = await validateData(
      telemetryHistoryQuerySchema,
      req.query
    );
    next();
  }
);
