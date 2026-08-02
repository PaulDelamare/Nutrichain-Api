import { Request, Response, NextFunction } from 'express';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { validateData } from '../../../../shared/utils/validateData/validateData';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';
import { withdrawalSchema, withdrawalListSchema } from './withdrawal.schema';

export const validateWithdrawal = catchAsync(
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    (req as AuthenticatedRequest).validatedWithdrawal = await validateData(withdrawalSchema, {
      id: req.params.id,
      id_client: req.body?.id_client,
      quantite: req.body?.quantite,
      motif: req.body?.motif,
      constate_aupres_de: req.body?.constate_aupres_de,
    });

    next();
  }
);

export const validateWithdrawalList = catchAsync(
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    (req as AuthenticatedRequest).validatedWithdrawalList = await validateData(
      withdrawalListSchema,
      { id: req.params.id }
    );

    next();
  }
);
