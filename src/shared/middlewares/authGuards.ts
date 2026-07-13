import { Request, NextFunction } from 'express';
import { APIError } from '../utils/errorHandler/APIError';
import { AuthenticatedRequest } from '../../modules/identity/types/auth.types';

/** Better-Auth accepte la session en Bearer (mobile) ou en cookie HttpOnly (web). */
export const hasUserSession = (req: Request): boolean => {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    return true;
  }

  const cookie = req.headers.cookie ?? '';
  return cookie.includes('better-auth') || cookie.includes('session_token');
};

/**
 * Garde multi-tenant, quel que soit le mode d'authentification : sans organisation active, les
 * requêtes Prisma `where: { organization_id: undefined }` ne filtrent PLUS RIEN — c'est-à-dire
 * qu'elles retournent les données de toutes les organisations.
 */
export const ensureActiveOrg = (req: Request, next: NextFunction): NextFunction => {
  return (err?: unknown) => {
    if (err) {
      return next(err);
    }

    if (!(req as AuthenticatedRequest).activeOrgId) {
      return next(
        new APIError(401, {
          error: [{ field: 'auth', message: 'Organisation active requise.' }],
        })
      );
    }

    next();
  };
};
