import { Request, Response, NextFunction } from 'express';
import { checkApiKey } from '../utils/checkApiKey/checkApiKey';
import { requireOrgRole } from '../../modules/identity/middlewares/requireOrgRole.middleware';
import { APIError } from '../utils/errorHandler/APIError';
import { AuthenticatedRequest } from '../../modules/identity/types/auth.types';

/**
 * Middleware hybride qui vérifie soit une clé API (M2M), soit une session utilisateur avec rôle (Web).
 *
 * Garde multi-tenant centralisée : quel que soit le mode d'auth, on exige une organisation
 * active résolue avant de poursuivre. Sans elle, les requêtes Prisma `where: { organization_id }`
 * filtreraient sur `undefined` (= pas de filtre = fuite cross-tenant). Le mode "frontend gate"
 * de checkApiKey (clé valide sans org bornée) est donc refusé sur les routes passant par mixedAuth.
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

    if (req.headers['x-api-key']) {
      return checkApiKey()(req, res, ensureOrg);
    }

    return requireOrgRole(allowedRoles)(req, res, ensureOrg);
  };
};
