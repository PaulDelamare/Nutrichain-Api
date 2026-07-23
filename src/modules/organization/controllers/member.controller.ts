import { Response } from 'express';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { memberService } from '../services/member.service';
import { APIError } from '../../../shared/utils/errorHandler/APIError';

/**
 * Un `as string` sur `req.activeOrgId` laissait passer `undefined` jusqu'au service, où
 * `where: { id, organizationId: undefined }` ne filtre plus rien — Prisma omet les champs
 * `undefined` — et révoque donc le membre d'une autre organisation. `ensureActiveOrg` le couvre
 * en amont : cette garde est la seconde barrière, celle qui reste si la route change.
 */
function contexteAppelant(req: AuthenticatedRequest) {
  const activeOrgId = req.activeOrgId;
  const actorUserId = req.auth?.user?.id;

  if (!activeOrgId || !actorUserId) {
    throw new APIError(401, {
      error: [{ field: 'auth', message: 'Authentification requise pour cette action.' }],
    });
  }

  return { activeOrgId, actorUserId };
}

export const changeMemberRoleController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const { activeOrgId, actorUserId } = contexteAppelant(req);

    const member = await memberService.changeRole(
      req.params.id,
      req.body.role,
      activeOrgId,
      actorUserId
    );
    sendSuccess(res, 200, 'Rôle du membre mis à jour', member);
  }
);

export const revokeMemberController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const { activeOrgId, actorUserId } = contexteAppelant(req);

    await memberService.revoke(req.params.id, activeOrgId, actorUserId);
    sendSuccess(res, 200, 'Accès du membre révoqué', { id: req.params.id });
  }
);
