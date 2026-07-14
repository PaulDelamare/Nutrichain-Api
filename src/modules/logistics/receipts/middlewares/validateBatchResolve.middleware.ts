import { Response, NextFunction } from 'express';
import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';
import { validateData } from '../../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';

/**
 * Le numéro de lot vient d'un code scanné : on le borne avant qu'il n'atteigne la base.
 * 20 caractères est la limite GS1 de l'AI 10 — au-delà, ce n'est pas un numéro de lot.
 */
export const batchResolveSchema = vine.object({
  lot_number: vine.string().trim().minLength(1).maxLength(20),
});

export type BatchResolveQuery = Infer<typeof batchResolveSchema>;

export const validateBatchResolve = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    req.validatedBatchResolve = await validateData(batchResolveSchema, req.query);

    next();
  }
);
