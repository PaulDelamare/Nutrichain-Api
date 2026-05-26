import { NextFunction, Request, Response } from 'express';
import { APIError } from '../errorHandler/APIError';
import { AuthenticatedRequest } from '../../../modules/identity/types/auth.types';

/**
 * Générateur de middleware pour vérifier une clé API spécifique.
 * Dans une architecture multi-tenant, une clé API devrait idéalement être liée à une organisation.
 *
 * @param expectedApiKey - La clé API attendue (par exemple, provenant de process.env)
 * @param defaultOrgId - Optionnel: ID de l'organisation à injecter si la clé est valide
 * @return - Un middleware Express qui valide la clé API
 */
export const checkApiKey = (expectedApiKey?: string, defaultOrgId?: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // OPTIONS preflight requests must not be blocked — the browser never sends
    // custom headers on preflights, so we let CORS middleware handle them.
    if (req.method === 'OPTIONS') {
      return next();
    }

    const targetKey = expectedApiKey ?? process.env.API_KEY;
    const apiKeyHeader = req.header('x-api-key');
    const orgIdHeader = req.header('x-org-id') || defaultOrgId;

    if (targetKey && apiKeyHeader === targetKey) {
      // Si on utilise une clé API, on injecte l'organisation active
      // Cela permet aux services (IoT, automatisés) d'être isolés.
      if (orgIdHeader) {
        const authReq = req as AuthenticatedRequest;
        authReq.activeOrgId = orgIdHeader;
        authReq.auth = {
          ...(authReq.auth || {}),
          activeOrgId: orgIdHeader,
        } as AuthContext;
      }

      next();
    } else {
      next(
        new APIError(401, {
          error: [{ field: 'api_key', message: 'Non authentifié. Clé API invalide ou manquante.' }],
        })
      );
    }
  };
};
