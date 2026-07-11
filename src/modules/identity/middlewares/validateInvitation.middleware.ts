import vine from '@vinejs/vine';
import { Request, Response, NextFunction } from 'express';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { USER_ROLES } from '../constants/roles.constants';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';

/**
 * Schéma de validation pour la création d'une invitation.
 */
// organizationId n'est PAS validé ici : le contrôleur l'ignore et prend
// req.auth.activeOrgId (session), garanti par requireOrgRole. Le valider en UUID
// rejetait à tort les organisations à id lisible (ex. slug 'usine-laitiere-paris').
const invitationSchema = vine.object({
  email: vine.string().email(),
  role: vine.enum(USER_ROLES),
});

/**
 * Middleware Express pour valider les paramètres d'invitation avec VineJS
 */
export const validateInvitationParams = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    await validateData(invitationSchema, req.body);
    next();
  }
);
