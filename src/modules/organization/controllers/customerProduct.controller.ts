import { Response } from 'express';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { customerService } from '../services/customer.service';
import { productService } from '../services/product.service';

const org = (req: AuthenticatedRequest) => req.activeOrgId as string;
const actor = (req: AuthenticatedRequest) => req.auth!.user!.id;

// ---- Clients ----
export const createCustomerController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const customer = await customerService.create(req.body, org(req), actor(req));
    sendSuccess(res, 201, 'Client créé', customer);
  }
);

export const updateCustomerController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const customer = await customerService.update(req.params.id, req.body, org(req), actor(req));
    sendSuccess(res, 200, 'Client modifié', customer);
  }
);

export const setCustomerActiveController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const customer = await customerService.setActive(
      req.params.id,
      req.body.active,
      org(req),
      actor(req)
    );
    sendSuccess(res, 200, customer.is_active ? 'Client réactivé' : 'Client archivé', customer);
  }
);

// ---- Produits ----
export const createProductController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const product = await productService.create(req.body, org(req), actor(req));
    sendSuccess(res, 201, 'Produit créé', product);
  }
);

export const updateProductController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const product = await productService.update(req.params.id, req.body, org(req), actor(req));
    sendSuccess(res, 200, 'Produit modifié', product);
  }
);

export const setProductActiveController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const product = await productService.setActive(
      req.params.id,
      req.body.active,
      org(req),
      actor(req)
    );
    sendSuccess(res, 200, product.is_active ? 'Produit réactivé' : 'Produit archivé', product);
  }
);
