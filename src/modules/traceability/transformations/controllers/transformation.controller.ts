import { Response } from 'express';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../../shared/utils/returnSuccess/returnSuccess';
import { transformationService } from '../services/transformation.service';
import { AuthenticatedRequest } from '../../../identity/middlewares/requireAuth.middleware';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

/**
 * Contrôleur pour les transformations de lots (Généalogie).
 */
export const createTransformation = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const activeOrgId = req.activeOrgId || req.auth?.activeOrgId;
  const userId = req.auth?.user?.id;

  if (!activeOrgId || !userId) {
    throw new APIError(401, {
      error: [{ field: 'auth', message: 'Authentification requise pour cette action.' }],
    });
  }

  const validatedTransformation = req.validatedTransformation;

  const result = await transformationService.createTransformation({
    ...validatedTransformation,
    organization_id: activeOrgId,
    created_by: userId,
  });

  return sendSuccess(
    res,
    201,
    'Transformation enregistrée avec succès. Stock et généalogie mis à jour.',
    result
  );
});
