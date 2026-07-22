import { Response, NextFunction } from 'express';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { telemetryPingSchema } from './telemetryPing.schema';

/**
 * Validation « fail fast » de `POST /api/telemetry/ping`, la seule route mutante qui n'en avait pas.
 * Une trame malformée doit être refusée à la frontière, en 400 et en français, plutôt que de
 * remonter en 500 depuis Mongoose — un capteur qui reçoit 500 rejoue indéfiniment.
 */
export const validateTelemetryPing = catchAsync(
  async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    req.validatedTelemetryPing = await validateData(telemetryPingSchema, req.body);

    next();
  }
);
