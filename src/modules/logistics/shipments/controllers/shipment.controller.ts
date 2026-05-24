import { Response } from 'express';
import { shipmentService } from '../services/shipment.service';
import { sendSuccess } from '../../../../shared/utils/returnSuccess/returnSuccess';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';

/**
 * Créer une expédition.
 */
export const createShipmentController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id_client, shipment_id, transporteur, lots, created_by } = req.validatedShipment;
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: lots.map((l: any) => ({ id_lot: l.id_lot, quantite: l.quantite_expediee })),
    });

    return sendSuccess(res, 201, 'Expédition créée avec succès', { shipment });
  }
);
