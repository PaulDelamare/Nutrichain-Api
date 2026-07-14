import { Response } from 'express';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { alertBatchService } from '../services/alertBatch.service';

/**
 * Controller GET /api/alerts/:id/batches — les lots que CETTE alerte a isolés.
 *
 * `req.alert` est garanti par verifyAlertAccess (404 anti-enumeration sinon, multi-tenant compris).
 */
export const listAlertBatchesController = catchAsync(
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const batches = await alertBatchService.listBatchesIsolatedByAlert(req.alert!);

    sendSuccess(res, 200, 'Lots isolés par cette alerte récupérés avec succès.', batches);
  }
);

export default listAlertBatchesController;
