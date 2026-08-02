import { Request, Response, NextFunction } from 'express';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { validateData } from '../../../../shared/utils/validateData/validateData';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';
import { recallSimulationSchema } from './recallPayload.schema';

/**
 * Valide le lot source d'une simulation de rappel. Le chemin de lecture voisin (`/genealogy`) n'a
 * aucune validation de `:id` — ne pas le recopier : une entrée non validée atteint la CTE
 * récursive et la requête d'expéditions sans qu'aucune borne ne la précède.
 */
export const validateRecallSimulation = catchAsync(
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    (req as AuthenticatedRequest).validatedRecallSimulation = await validateData(
      recallSimulationSchema,
      { id: req.params.id }
    );

    next();
  }
);
