import { Response, NextFunction } from 'express';
import vine from '@vinejs/vine';
import { validateData } from '../../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';

/**
 * Validation des données d'entrée pour une expédition (Shipment).
 *
 * Basé sur le plan de la Phase 3 : Poids, Destination, Transporteur.
 */
export const validateShipmentParams = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const schema = vine.object({
      id_client: vine.string().uuid(),
      shipment_id: vine.string().minLength(3).maxLength(100),
      transporteur: vine.string().minLength(2).maxLength(100),
      destination_adresse: vine.string().minLength(5),
      created_by: vine.string().uuid().optional(),
      lots: vine
        .array(
          vine.object({
            id_lot: vine.string().uuid(),
            quantite_expediee: vine.number().positive(),
          })
        )
        .minLength(1),
    });

    const validatedData = await validateData(schema, req.body);

    // On attache les données validées à la requête pour le contrôleur
    req.validatedShipment = validatedData;

    next();
  }
);
