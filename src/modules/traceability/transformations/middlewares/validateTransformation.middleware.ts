import { Request, Response, NextFunction } from 'express';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { validateData } from '../../../../shared/utils/validateData/validateData';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';
import { transformationSchema } from './transformationPayload.schema';

/**
 * Validation des données d'entrée pour une transformation (Généalogie).
 *
 * Un produit fini est créé à partir d'un ou plusieurs composants (lots parents).
 */
export const validateTransformationParams = catchAsync(
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const validatedData = await validateData(transformationSchema, req.body);
    (req as AuthenticatedRequest).validatedTransformation = validatedData;

    next();
  }
);
