import { Response } from 'express';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { auditVerifyService } from '../services/auditVerify.service';

/**
 * Controller GET /api/audit/verify.
 *
 * Vérifie l'intégrité de la chaîne d'audit WORM de l'organisation active.
 * Retourne 200 dans tous les cas — même quand la chaîne est cassée — car
 * un état "broken" est une information, pas une erreur HTTP serveur.
 *
 * `Cache-Control: no-store` : le résultat dépend de l'état mutable de la
 * chaîne (un tampering change l'output). Pas de cache HTTP intermédiaire.
 */
export const auditVerifyController = catchAsync(
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const activeOrgId = req.activeOrgId;
    if (!activeOrgId) {
      throw new APIError(400, {
        error: [{ field: 'organization', message: 'Organisation active manquante.' }],
      });
    }

    const result = await auditVerifyService.verifyChain({ organizationId: activeOrgId });

    res.setHeader('Cache-Control', 'no-store');
    sendSuccess(res, 200, "Chaîne d'audit vérifiée.", { organizationId: activeOrgId, ...result });
  }
);

export default auditVerifyController;
