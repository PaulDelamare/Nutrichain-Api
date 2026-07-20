import { Request, Response, NextFunction } from 'express';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { validateData } from '../../../../shared/utils/validateData/validateData';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';
import { recallSchema } from './recallPayload.schema';

/**
 * Valide le déclenchement d'un rappel : le lot source (`:id`, UUID) et le motif (`reason`, chaîne
 * bornée). Sans ce garde-fou, un motif non-chaîne cassait la requête SQL de blocage (rollback → le
 * rappel n'avait pas lieu) et un `:id` non-UUID renvoyait un 500 Prisma au lieu d'un 404.
 */
export const validateRecall = catchAsync(
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    (req as AuthenticatedRequest).validatedRecall = await validateData(recallSchema, {
      id: req.params.id,
      reason: req.body?.reason,
    });

    next();
  }
);
