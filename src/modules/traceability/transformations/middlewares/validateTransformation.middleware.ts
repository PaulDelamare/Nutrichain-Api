import { Request, Response, NextFunction } from 'express';
import vine from '@vinejs/vine';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { validateData } from '../../../../shared/utils/validateData/validateData';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';

/**
 * Validation des données d'entrée pour une transformation (Généalogie).
 *
 * Un produit fini est créé à partir d'un ou plusieurs composants (lots parents).
 */
export const validateTransformationParams = catchAsync(
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const schema = vine.object({
      id_produit_fini: vine.string().uuid(),
      id_materiel: vine.string().uuid(),
      quantite_produite: vine.number().positive().decimal({ places: 2 }),
      unite_code: vine.string().maxLength(10),
      date_peremption: vine.string().optional(),
      note_technique: vine.record(vine.any()).optional(),

      // Liste des composants utilisés
      inputs: vine
        .array(
          vine.object({
            id_lot_parent: vine.string().uuid(),
            quantite_prelevee: vine.number().positive().decimal({ places: 2 }),
            unite: vine.string().maxLength(10),
            lot_parent_epuise: vine.boolean(),
          })
        )
        .minLength(1),
    });

    const validatedData = await validateData(schema, req.body);
    (req as AuthenticatedRequest).validatedTransformation = validatedData;

    next();
  }
);
