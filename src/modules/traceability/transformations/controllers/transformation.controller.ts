import { Response } from 'express';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../../shared/utils/returnSuccess/returnSuccess';
import { transformationService } from '../services/transformation.service';
import { AuthenticatedRequest } from '../../../identity/middlewares/requireAuth.middleware';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { parseExpiryDay } from '../../../../shared/utils/expiryDate/expiryDate';

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
  if (!validatedTransformation) {
    throw new APIError(500, {
      error: [{ field: 'transformation', message: 'Données de transformation non validées.' }],
    });
  }

  const result = await transformationService.createTransformation({
    ...validatedTransformation,
    // Validé en string (format) mais le service attend une Date — un `new Date()` brut acceptait
    // un jour inexistant (décalage silencieux) et ancrait à minuit UTC (un lot naissait périmé
    // dès sa DLC) ; `parseExpiryDay` refuse les deux, comme à la réception (cf. #120).
    date_peremption: validatedTransformation.date_peremption
      ? parseExpiryDay(validatedTransformation.date_peremption)
      : undefined,
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
