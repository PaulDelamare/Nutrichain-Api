import { Response, NextFunction } from 'express';
import { validateData } from '../../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';
import { receiptValidationSchema } from './receiptPayload.schema';

/**
 * Validation des données d'entrée pour une réception (flow direct POST /logistics/receipts).
 *
 * Appliqué AVANT le contrôleur (Fail Fast).
 * Les erreurs sont catchées par le errorHandler global via next(error).
 *
 * Les champs métier viennent de `receiptPayload.schema.ts` (DRY avec validateSyncScans).
 * `received_by` est spécifique à ce flow (en M2M direct, le payload fournit l'opérateur).
 */
export const validateReceiptParams = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const validatedData = await validateData(receiptValidationSchema, req.body);
    req.validatedReceipt = validatedData;

    next();
  }
);
