import vine from '@vinejs/vine';
import { Request, Response, NextFunction } from 'express';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { USER_ROLES } from '../constants/roles.constants';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';

/**
 * Schéma de validation pour la création d'une invitation.
 */
const invitationSchema = vine.object({
  email: vine.string().email(),
  role: vine.enum(USER_ROLES),
  organizationId: vine.string().uuid(),
});

/**
 * Middleware Express pour valider les paramètres d'invitation avec VineJS
 */
export const validateInvitationParams = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  await validateData(invitationSchema, req.body);
  next();
});
