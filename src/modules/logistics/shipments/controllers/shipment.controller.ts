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
    const { id_client, shipment_id, transporteur, destination_adresse, lots, palettes } =
      validatedShipment;
    const activeOrgId = req.activeOrgId as string;

    // L'auteur vient de la session, et de NULLE PART ailleurs (cf. `receipt.controller`).
    const userId = req.auth?.user?.id;

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
      destination_adresse,
      date_envoi: new Date(),
      created_by: userId,
      // `lots` est facultatif depuis qu'on peut charger des palettes. « Au moins l'un des deux »
      // se tranche dans le service : VineJS ne sait pas exprimer cette dépendance entre champs.
      items: (lots ?? []).map((l: { id_lot: string; quantite_expediee: number }) => ({
        id_lot: l.id_lot,
        quantite: l.quantite_expediee,
      })),
      palettes,
    });

    return sendSuccess(res, 201, 'Expédition créée avec succès', { shipment });
  }
);

/**
 * Constater l'arrivée d'une expédition.
 *
 * L'auteur vient de la session. Le confirmant sans compte — le transporteur — passera par une autre
 * route, avec son propre mécanisme d'accès : ce n'est pas à cette route-ci de l'accepter.
 */
export const confirmDeliveryController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const params = req.validatedShipmentIdParam;
    if (!params) {
      throw new APIError(500, {
        error: [{ field: 'id', message: "Identifiant d'expédition non validé." }],
      });
    }

    const userId = req.auth?.user?.id;
    if (!userId) {
      throw new APIError(401, {
        error: [{ field: 'auth', message: 'Auteur de la confirmation non identifié.' }],
      });
    }

    const shipment = await shipmentService.confirmDelivery(params.id, req.activeOrgId as string, {
      userId,
      dateLivraison: req.validatedConfirmDelivery?.date_livraison,
    });

    sendSuccess(res, 200, 'Livraison confirmée.', shipment);
  }
);
