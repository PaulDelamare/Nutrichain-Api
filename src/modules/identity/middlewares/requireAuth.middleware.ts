import { Response, NextFunction } from 'express';
import { auth } from '../auth.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { AuthenticatedRequest, AuthUser, AuthSession } from '../types/auth.types';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';

// Ré-export pour les controllers qui importent le type depuis le middleware
export type { AuthenticatedRequest } from '../types/auth.types';

/**
 * Middleware qui intercepte la requête, vérifie si l'utilisateur est authentifié via `better-auth`.
 * Si oui, ajoute l'utilisateur (user) et sa session dans `req.auth`.
 * Sinon, bloque la requête en retournant 401 Unauthorized.
 */
export const requireAuth = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // En Express, pour Better Auth on passe le req et res à api.getSession
    const sessionPayload = await auth.api.getSession({
      headers: new Headers(req.headers as Record<string, string>),
    });

    if (!sessionPayload || !sessionPayload.session) {
      throw new APIError(401, {
        error: [{ field: 'auth', message: 'Accès refusé. Veuillez vous authentifier.' }],
      });
    }

    const { user, session } = sessionPayload;
    const activeOrgId = session.activeOrganizationId || undefined;

    // On stocke les infos pour les utiliser dans les contrôleurs via req.auth
    req.auth = {
      user: user as AuthUser,
      session: session as AuthSession,
      activeOrgId,
    };

    // Injection directe pour compatibilité et facilité d'accès
    req.user = user as AuthUser;
    req.session = session as AuthSession;
    req.activeOrgId = activeOrgId;

    next();
  }
);
