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
    const { id_client, shipment_id, transporteur, lots } = req.validatedShipment;
    const activeOrgId = req.activeOrgId as string;
    const userId = req.user?.id || 'EXTERNAL_SYSTEM';

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

    return sendSuccess(res, 'Expédition créée avec succès', { shipment });
  }
);
