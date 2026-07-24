import vine from '@vinejs/vine';
import { Infer } from '@vinejs/vine/build/src/types';
import { Request, Response, NextFunction } from 'express';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../identity/types/auth.types';

// Le slug identifie l'organisation dans l'URL et les identifiants : minuscules, chiffres, tirets.
const createOrganizationSchema = vine.object({
  name: vine.string().trim().minLength(2).maxLength(120),
  slug: vine
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .minLength(2)
    .maxLength(60),
  gs1_company_prefix: vine
    .string()
    .trim()
    .regex(/^\d{6,12}$/)
    .optional(),
});

const inviteOwnerSchema = vine.object({
  email: vine.string().trim().email(),
});

export type CreateOrganizationPayload = Infer<typeof createOrganizationSchema>;
export type InviteOwnerPayload = Infer<typeof inviteOwnerSchema>;

// `validateData` RENVOIE la donnée validée ET transformée (trim, toLowerCase du slug). On la stocke
// sur `req` pour que le contrôleur la transmette au service : lire `req.body` brut à la place
// enregistrerait un slug non canonique (majuscules, espaces) que la validation était censée corriger.
export const validateCreateOrganization = catchAsync(
  async (req: Request, _res: Response, next: NextFunction) => {
    (req as AuthenticatedRequest).validatedCreateOrganization = await validateData(
      createOrganizationSchema,
      req.body
    );
    next();
  }
);

export const validateInviteOwner = catchAsync(
  async (req: Request, _res: Response, next: NextFunction) => {
    (req as AuthenticatedRequest).validatedInviteOwner = await validateData(
      inviteOwnerSchema,
      req.body
    );
    next();
  }
);
