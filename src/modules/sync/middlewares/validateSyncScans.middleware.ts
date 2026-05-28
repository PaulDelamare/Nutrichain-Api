import { Response, NextFunction } from 'express';
import vine from '@vinejs/vine';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { SyncScansPayload } from '../types/sync.types';
import { receiptPayloadSchema } from '../../logistics/receipts/middlewares/receiptPayload.schema';

/**
 * Validation Fail Fast du payload POST /api/sync/scans.
 *
 * Contraintes :
 * - items : array, min 1, max 100 (DoS guard + objectif latence < 500ms / 50 items)
 * - clientOpId : UUID v4 généré par le mobile au moment du scan offline
 * - type : actuellement 'receipt' uniquement (v1) — extensible sans breaking change
 * - payload : `receiptPayloadSchema` partagé avec `validateReceipt` (DRY)
 * - `received_by` n'est pas dans le payload : forcé serveur-side par le service (anti-usurpation)
 * - actorUserId : optionnel, utilisé uniquement en M2M
 */
export const validateSyncScans = catchAsync(
  async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    const itemSchema = vine.object({
      clientOpId: vine.string().uuid(),
      type: vine.enum(['receipt']),
      payload: receiptPayloadSchema,
    });

    const schema = vine.object({
      items: vine.array(itemSchema).minLength(1).maxLength(100),
      actorUserId: vine.string().uuid().optional(),
    });

    const validated = (await validateData(schema, req.body)) as SyncScansPayload;
    req.validatedSyncScans = validated;

    next();
  }
);
