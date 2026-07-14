import { Response } from 'express';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { supplierService } from '../services/supplier.service';
import { locationService } from '../services/location.service';

const org = (req: AuthenticatedRequest) => req.activeOrgId as string;
const actor = (req: AuthenticatedRequest) => req.auth!.user!.id;

// La LECTURE (liste) reste dans les controllers historiques (organization/equipment), enrichis du
// filtre `is_active`. Ici : uniquement les ÉCRITURES.

// ---- Fournisseurs ----
export const createSupplierController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const supplier = await supplierService.create(req.body, org(req), actor(req));
    sendSuccess(res, 201, 'Fournisseur créé', supplier);
  }
);

export const updateSupplierController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const supplier = await supplierService.update(req.params.id, req.body, org(req), actor(req));
    sendSuccess(res, 200, 'Fournisseur modifié', supplier);
  }
);

export const setSupplierActiveController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const supplier = await supplierService.setActive(
      req.params.id,
      req.body.active,
      org(req),
      actor(req)
    );
    sendSuccess(
      res,
      200,
      supplier.is_active ? 'Fournisseur réactivé' : 'Fournisseur archivé',
      supplier
    );
  }
);

// ---- Emplacements ----
export const createLocationController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const location = await locationService.create(req.body, org(req), actor(req));
    sendSuccess(res, 201, 'Emplacement créé', location);
  }
);

export const updateLocationController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const location = await locationService.update(req.params.id, req.body, org(req), actor(req));
    sendSuccess(res, 200, 'Emplacement modifié', location);
  }
);

export const setLocationActiveController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const location = await locationService.setActive(
      req.params.id,
      req.body.active,
      org(req),
      actor(req)
    );
    sendSuccess(
      res,
      200,
      location.is_active ? 'Emplacement réactivé' : 'Emplacement archivé',
      location
    );
  }
);
