import { Response, NextFunction } from 'express';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { simulateIncidentSchema } from './simulateIncident.schema';

/**
 * Validation « fail fast » du déclenchement de simulation. Le corps peut être vide (auto-sélection
 * du matériel) : on normalise donc `undefined` en objet vide avant de valider.
 */
export const validateSimulateIncident = catchAsync(
  async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    req.validatedSimulateIncident = await validateData(simulateIncidentSchema, req.body ?? {});

    next();
  }
);
