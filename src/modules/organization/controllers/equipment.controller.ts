import { Response } from 'express';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { labelService } from '../../logistics/shared/services/label.service';
import { equipmentService } from '../services/equipment.service';
import { ADMIN_ROLES } from '../../identity/constants/roles.constants';
import { LOCATION_PAGE_DEFAULTS } from '../middlewares/locationQuery.schema';

/**
 * Voir les archivés est un usage d'ADMINISTRATION (pour réactiver). Un rôle en lecture ne doit pas
 * pouvoir énumérer ce qui a été retiré du service — on ignore alors le paramètre plutôt que de
 * refuser, pour ne pas casser un appelant qui le passerait par défaut.
 */
function wantsArchived(req: AuthenticatedRequest): boolean {
  const role = req.auth?.role;
  return req.query.includeArchived === 'true' && (ADMIN_ROLES as string[]).includes(role ?? '');
}

export const listLocationsController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const q = req.validatedLocationQuery ?? {};

    // Chemin paginé (écran Configuration) quand `page` est présent ; sinon tableau simple pour les
    // sélecteurs de l'app (rétrocompatible).
    if (q.page !== undefined) {
      const result = await equipmentService.listLocationsPaginated(req.activeOrgId as string, {
        page: q.page,
        limit: q.limit ?? LOCATION_PAGE_DEFAULTS.limit,
        nom: q.nom,
        type: q.type,
        statut: q.statut,
      });
      sendSuccess(res, 200, 'Lieux récupérés', result);
      return;
    }

    const locations = await equipmentService.listLocations(
      req.activeOrgId as string,
      wantsArchived(req)
    );
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
