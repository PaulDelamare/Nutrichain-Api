import { Response } from 'express';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { labelService } from '../../logistics/shared/services/label.service';
import { equipmentService } from '../services/equipment.service';

export const listLocationsController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const locations = await equipmentService.listLocations(req.activeOrgId as string);
    sendSuccess(res, 200, 'Lieux récupérés', locations);
  }
);

export const createEquipmentController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const payload = req.validatedEquipment!;

    const equipment = await equipmentService.createEquipment({
      ...payload,
      organization_id: req.activeOrgId as string,
      created_by: req.auth!.user!.id,
    });

    sendSuccess(res, 201, 'Matériel créé', equipment);
  }
);

/**
 * L'étiquette à imprimer et coller sur le matériel : c'est elle que l'opérateur scanne pour
 * déclarer où il range un lot. Sans elle, l'emplacement resterait vide — et un lot sans
 * emplacement n'est jamais mis en quarantaine si son frigo dérive.
 */
export const getEquipmentLabelController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const { code, nom } = await equipmentService.getScannableLabel(
      req.activeOrgId as string,
      req.params.id
    );

    const png = await labelService.generateQRCode(code);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Equipment-Code', code);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(nom)}.png"`);
    res.send(png);
  }
);
