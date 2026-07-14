import vine from '@vinejs/vine';
import { Request, Response, NextFunction } from 'express';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';

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
  email: vine.string().email(),
});

export const validateCreateOrganization = catchAsync(
  async (req: Request, _res: Response, next: NextFunction) => {
    await validateData(createOrganizationSchema, req.body);
    next();
  }
);

export const validateInviteOwner = catchAsync(
  async (req: Request, _res: Response, next: NextFunction) => {
    await validateData(inviteOwnerSchema, req.body);
    next();
  }
);
