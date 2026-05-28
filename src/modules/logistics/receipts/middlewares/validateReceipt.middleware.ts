import { Response, NextFunction } from 'express';
import vine from '@vinejs/vine';
import { validateData } from '../../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';
import { receiptPayloadFields } from './receiptPayload.schema';

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
    const schema = vine.object({
      ...receiptPayloadFields,
      received_by: vine.string().uuid(),
    });

    const validatedData = await validateData(schema, req.body);
    req.validatedReceipt = validatedData;

    next();
  }
);
