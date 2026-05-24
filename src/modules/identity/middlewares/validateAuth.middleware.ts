import vine from '@vinejs/vine';
import { RequestHandler } from 'express';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { passwordRule } from '../../../shared/utils/validateData/customRules';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';

const signUpSchema = vine.object({
  email: vine.string().email(),
  password: vine.string().use(passwordRule()),
  name: vine.string().minLength(2),
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
