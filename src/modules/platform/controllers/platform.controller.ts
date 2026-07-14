import { Response } from 'express';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { platformService } from '../services/platform.service';

export const createOrganizationController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const org = await platformService.createOrganization(req.body, req.auth!.user.id);
    sendSuccess(res, 201, 'Organisation créée.', org);
  }
);

export const listOrganizationsController = catchAsync(
  async (_req: AuthenticatedRequest, res: Response) => {
    const orgs = await platformService.listOrganizations();
    sendSuccess(res, 200, 'Organisations récupérées.', orgs);
  }
);

export const inviteOwnerController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const result = await platformService.inviteOwner(req.params.id, req.body.email, {
      id: req.auth!.user.id,
      email: req.auth!.user.email,
    });
    sendSuccess(res, 201, "Invitation envoyée au premier pilote de l'organisation.", result);
  }
);
