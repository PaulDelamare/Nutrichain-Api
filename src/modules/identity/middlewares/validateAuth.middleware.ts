import vine from '@vinejs/vine';
import { RequestHandler } from 'express';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { passwordRule } from '../../../shared/utils/validateData/customRules';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';

const signUpSchema = vine.object({
  email: vine.string().email(),
  password: vine.string().use(passwordRule()),
  name: vine.string().minLength(2),
  // Token reçu par email (UUID de l'Invitation). Optionnel uniquement dans le schéma car
  // le tout premier utilisateur du système n'en a pas. Le middleware `requireInvitationOrFirstUser`
  // l'exige strictement dès qu'au moins 1 user existe en DB.
  token: vine.string().uuid().optional(),
});

const signInSchema = vine.object({
  email: vine.string().email(),
  password: vine.string(),
});

export const validateSignUpParams: RequestHandler = catchAsync(async (req, res, next) => {
  await validateData(signUpSchema, req.body);
  next();
});

export const validateSignInParams: RequestHandler = catchAsync(async (req, res, next) => {
  await validateData(signInSchema, req.body);
  next();
});
