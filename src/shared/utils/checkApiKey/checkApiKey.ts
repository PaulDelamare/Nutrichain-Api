import { NextFunction, Request, Response } from 'express';
import { APIError } from '../errorHandler/APIError';
import { AuthenticatedRequest, AuthContext } from '../../../modules/identity/types/auth.types';

/**
 * Vérifie une clé API et résout l'organisation depuis l'environnement (jamais depuis le client).
 *
 * @param expectedApiKey - clé attendue (défaut : `process.env.API_KEY`)
 * @param defaultOrgId   - org à injecter (défaut : `process.env.API_KEY_ORG_ID`)
 *
 * Si aucune source d'org n'est définie, le middleware fonctionne en mode "frontend gate" :
 * il valide la clé mais n'injecte pas d'`activeOrgId`. Le header `x-org-id` est ignoré.
 */
export const checkApiKey = (expectedApiKey?: string, defaultOrgId?: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const targetKey = expectedApiKey ?? process.env.API_KEY;
    const apiKeyHeader = req.header('x-api-key');
    const boundOrgId = defaultOrgId ?? process.env.API_KEY_ORG_ID;

    if (targetKey && apiKeyHeader === targetKey) {
      if (boundOrgId) {
        const authReq = req as AuthenticatedRequest;
        authReq.activeOrgId = boundOrgId;
        authReq.auth = {
          ...(authReq.auth || {}),
          activeOrgId: boundOrgId,
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
