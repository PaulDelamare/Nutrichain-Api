import { Response } from 'express';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { iotGatewayService } from '../services/iotGateway.service';

const org = (req: AuthenticatedRequest) => req.activeOrgId as string;
const actor = (req: AuthenticatedRequest) => req.auth!.user!.id;

export const listIotGatewaysController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const gateways = await iotGatewayService.list(org(req));
    sendSuccess(res, 200, 'Passerelles IoT', gateways);
  }
);

export const createIotGatewayController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const gateway = await iotGatewayService.create(req.body.nom, org(req), actor(req));
    sendSuccess(
      res,
      201,
      'Passerelle créée. Copiez la clé maintenant : elle ne sera plus jamais affichée.',
      gateway
    );
  }
);

export const revokeIotGatewayController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const gateway = await iotGatewayService.revoke(req.params.id, org(req), actor(req));
    sendSuccess(res, 200, 'Passerelle révoquée', gateway);
  }
);
