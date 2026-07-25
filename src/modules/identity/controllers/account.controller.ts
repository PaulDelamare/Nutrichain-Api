import { Response } from 'express';
import { AuthenticatedRequest } from '../types/auth.types';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { resolveWritingActor } from '../../../shared/utils/auth/resolveWritingActor';
import { accountService } from '../services/account.service';

export const deleteMyAccountController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = resolveWritingActor({ sessionUserId: req.auth?.user?.id });

    await accountService.deleteMyAccount(userId);
    sendSuccess(res, 200, 'Compte anonymisé. Vous avez été déconnecté.', null);
  }
);
