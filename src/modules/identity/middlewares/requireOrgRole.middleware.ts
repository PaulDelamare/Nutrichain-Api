import { Response, NextFunction } from 'express';
import { auth } from '../auth.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { AuthenticatedRequest, AuthUser, AuthSession } from '../types/auth.types';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { resolveActiveOrgId } from '../utils/resolveActiveOrgId';

/**
 * Middleware pour Exiger un Rôle Spécifique au sein de l'Organisation active.
 *
 * @param allowedRoles Liste des rôles autorisés (ex: 'owner', 'admin', 'operator', etc.)
 */
export const requireOrgRole = (allowedRoles: string[]) => {
  return catchAsync(
    async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
      const sessionPayload = await auth.api.getSession({
        headers: new Headers(req.headers as Record<string, string>),
      });

      if (!sessionPayload || !sessionPayload.session || !sessionPayload.user) {
        throw new APIError(401, {
          error: [{ field: 'auth', message: 'Non authentifié' }],
        });
      }

      req.auth = {
        user: sessionPayload.user as AuthUser,
        session: sessionPayload.session as AuthSession,
      };
      req.user = sessionPayload.user as AuthUser;
      req.session = sessionPayload.session as AuthSession;

      const activeOrgId = await resolveActiveOrgId(req);

      const orgDetails = await auth.api.getFullOrganization({
        headers: new Headers(req.headers as Record<string, string>),
        query: { organizationId: activeOrgId },
      });

      if (!orgDetails) {
        throw new APIError(403, {
          error: [{ field: 'auth', message: 'Organisation introuvable ou accès révoqué.' }],
        });
      }

      const memberDetails = orgDetails.members.find((m) => m.userId === sessionPayload.user.id);

      if (!memberDetails || !allowedRoles.includes(memberDetails.role)) {
        throw new APIError(403, {
          error: [
            { field: 'auth', message: `Action refusée. Rôle ${memberDetails?.role} insuffisant.` },
          ],
        });
      }

      // Injection typée
      req.auth = {
        activeOrgId,
        user: sessionPayload.user as AuthUser,
        role: memberDetails.role,
        session: sessionPayload.session as AuthSession,
      };

      req.activeOrgId = activeOrgId;

      next();
    }
  );
};
