import { Response, NextFunction } from 'express';
import { validateData } from '../../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';
import { palletScanSchema } from './palletScan.schema';

export const validatePalletScan = catchAsync(
  async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    await validateData(palletScanSchema, req.params);

    next();
  }
);
