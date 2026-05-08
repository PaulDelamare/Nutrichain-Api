import vine from '@vinejs/vine';
import { RequestHandler } from 'express';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { handleError } from '../../../shared/utils/errorHandler/errorHandler';
import { passwordRule } from '../../../shared/utils/validateData/customRules';

const signUpSchema = vine.object({
  email: vine.string().email(),
  password: vine.string().use(passwordRule()),
  name: vine.string().minLength(2),
});

const signInSchema = vine.object({
  email: vine.string().email(),
  password: vine.string(),
});

export const validateSignUpParams: RequestHandler = async (req, res, next) => {
  try {
    await validateData(signUpSchema, req.body);
    next();
  } catch (error) {
    handleError(error, req, res, 'Validation Inscription (SignUp)');
  }
};

export const validateSignInParams: RequestHandler = async (req, res, next) => {
  try {
    await validateData(signInSchema, req.body);
    next();
  } catch (error) {
    handleError(error, req, res, 'Validation Connexion (SignIn)');
  }
};
