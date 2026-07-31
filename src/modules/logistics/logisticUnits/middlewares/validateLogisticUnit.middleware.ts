import { Response, NextFunction } from 'express';
import { validateData } from '../../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';
import {
  createLogisticUnitSchema,
  moveLogisticUnitSchema,
  openLogisticUnitSchema,
  scanLogisticUnitSchema,
} from './logisticUnit.schema';

export const validateCreateLogisticUnit = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    req.validatedLogisticUnit = await validateData(createLogisticUnitSchema, req.body);
    next();
  }
);

export const validateScanLogisticUnit = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    req.validatedLogisticUnitScan = await validateData(scanLogisticUnitSchema, req.params);
    next();
  }
);

export const validateMoveLogisticUnit = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    req.validatedLogisticUnitMove = await validateData(moveLogisticUnitSchema, req.body);
    next();
  }
);

export const validateOpenLogisticUnit = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    req.validatedLogisticUnitOpen = await validateData(openLogisticUnitSchema, req.params);
    next();
  }
);
