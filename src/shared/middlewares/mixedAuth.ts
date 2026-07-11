import { Request, Response, NextFunction } from 'express';
import { checkApiKey } from '../utils/checkApiKey/checkApiKey';
import { requireOrgRole } from '../../modules/identity/middlewares/requireOrgRole.middleware';
import { APIError } from '../utils/errorHandler/APIError';
import { AuthenticatedRequest } from '../../modules/identity/types/auth.types';

/** Better-Auth accepte la session en Bearer (mobile) ou en cookie HttpOnly (web). */
const hasUserSession = (req: Request): boolean => {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    return true;
  }

  const cookie = req.headers.cookie ?? '';
  return cookie.includes('better-auth') || cookie.includes('session_token');
};

/**
 * Middleware hybride qui vérifie soit une clé API (M2M), soit une session utilisateur avec rôle (Web).
 *
 * Garde multi-tenant centralisée : quel que soit le mode d'auth, on exige une organisation
 * active résolue avant de poursuivre. Sans elle, les requêtes Prisma `where: { organization_id }`
 * filtreraient sur `undefined` (= pas de filtre = fuite cross-tenant). Le mode "frontend gate"
 * de checkApiKey (clé valide sans org bornée) est donc refusé sur les routes passant par mixedAuth.
 *
 * La session PRIME sur la clé API quand les deux sont présentes : les clients porteurs d'une
 * session (mobile, front SSR) envoient aussi la clé, exigée par `/api/auth/*`. Arbitrer sur sa
 * seule présence ignorerait l'utilisateur et bornerait l'organisation à `API_KEY_ORG_ID` —
 * chacun verrait alors les données de l'organisation de la clé, pas de la sienne.
 *
 * @param allowedRoles Liste des rôles autorisés si authentification par session
 */
export const mixedAuth = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const ensureOrg: NextFunction = (err?: unknown) => {
      if (err) return next(err);
      if (!(req as AuthenticatedRequest).activeOrgId) {
        return next(
          new APIError(401, {
            error: [{ field: 'auth', message: 'Organisation active requise.' }],
          })
        );
      }
      next();
    };

    if (req.headers['x-api-key'] && !hasUserSession(req)) {
      return checkApiKey()(req, res, ensureOrg);
    }

    return requireOrgRole(allowedRoles)(req, res, ensureOrg);
  };
};
