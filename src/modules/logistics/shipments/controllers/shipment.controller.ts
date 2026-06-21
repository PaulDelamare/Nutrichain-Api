import { Response } from 'express';
import { shipmentService } from '../services/shipment.service';
import { sendSuccess } from '../../../../shared/utils/returnSuccess/returnSuccess';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

/**
 * Créer une expédition.
 */
export const createShipmentController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const validatedShipment = req.validatedShipment;
    if (!validatedShipment) {
      throw new APIError(500, {
        error: [{ field: 'shipment', message: "Données d'expédition non validées." }],
      });
    }
    const { id_client, shipment_id, transporteur, lots, created_by } = validatedShipment;
    const activeOrgId = req.activeOrgId as string;

    // Détermination de l'auteur : Priorité à la session (req.user), fallback sur le payload (M2M)
    const userId = req.user?.id || created_by;

    if (!userId) {
      throw new APIError(401, {
        error: [{ field: 'auth', message: "Auteur de l'expédition non identifié." }],
      });
    }

    const shipment = await shipmentService.createShipment({
      organization_id: activeOrgId,
      id_client,
      shipment_id,
      transporteur,
      date_envoi: new Date(),
      created_by: userId,
      items: lots.map((l: { id_lot: string; quantite_expediee: number }) => ({
        id_lot: l.id_lot,
        quantite: l.quantite_expediee,
      })),
    });

    return sendSuccess(res, 201, 'Expédition créée avec succès', { shipment });
  }
);
