import { Response } from 'express';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { memberService } from '../services/member.service';

export const changeMemberRoleController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const member = await memberService.changeRole(
      req.params.id,
      req.body.role,
      req.activeOrgId as string,
      req.auth!.user!.id
    );
    sendSuccess(res, 200, 'Rôle du membre mis à jour', member);
  }
);

export const revokeMemberController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    await memberService.revoke(req.params.id, req.activeOrgId as string, req.auth!.user!.id);
    sendSuccess(res, 200, 'Accès du membre révoqué', { id: req.params.id });
  }
);
