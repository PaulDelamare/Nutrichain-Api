import { Response, NextFunction } from 'express';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { ALERT_NOT_FOUND_MSG } from '../constants/alert.constants';

/**
 * Middleware multi-tenant pour l'accès à une Alert.
 *
 * - findFirst sur (id, organization_id) — un cross-tenant retourne null.
 * - Anti-enumeration : 404 (pas 403) avec un message générique IDENTIQUE pour
 *   "alerte inexistante", "alerte d'une autre org" et "id malformé". Un attaquant
 *   ne peut pas distinguer ces cas par message ni par statut.
 * - Pas de pré-validation UUID : on laisse Postgres faire le filter et on tombe
 *   sur 404 — cohérent avec l'anti-enum (sinon un id malformé donnerait 400
 *   alors qu'un id valide cross-tenant donnerait 404).
 */
export const verifyAlertAccess = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const alertId = req.params.id as string;
    const activeOrgId = req.activeOrgId;

    // Si activeOrgId est absent (mauvais wiring : ce middleware doit suivre requireOrgRole),
    // on collapse en 404 anti-enumeration plutôt qu'un 400 distinct qui leakerait par status.
    if (!activeOrgId) {
      throw new APIError(404, {
        error: [{ field: 'alert', message: ALERT_NOT_FOUND_MSG }],
      });
    }

    const alert = await prisma.alert.findFirst({
      where: { id: alertId, organization_id: activeOrgId },
    });

    if (!alert) {
      throw new APIError(404, {
        error: [{ field: 'alert', message: ALERT_NOT_FOUND_MSG }],
      });
    }

    req.alert = alert;
    next();
  }
);

export default verifyAlertAccess;
