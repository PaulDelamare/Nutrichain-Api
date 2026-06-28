import { Response, NextFunction } from 'express';
import { validateData } from '../../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';
import { shipmentSchema } from './shipmentPayload.schema';

/**
 * Validation des données d'entrée pour une expédition (Shipment).
 *
 * Basé sur le plan de la Phase 3 : Poids, Destination, Transporteur.
 */
export const validateShipmentParams = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const validatedData = await validateData(shipmentSchema, req.body);

    // On attache les données validées à la requête pour le contrôleur
    req.validatedShipment = validatedData;

    next();
  }
);
