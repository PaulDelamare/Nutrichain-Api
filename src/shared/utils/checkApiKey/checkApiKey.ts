import { NextFunction, Request, Response } from 'express';
import { APIError } from '../errorHandler/APIError';
import { AuthenticatedRequest, AuthContext } from '../../../modules/identity/types/auth.types';

/**
 * L'organisation est résolue depuis `defaultOrgId` ou `process.env.API_KEY_ORG_ID` —
 * le header `x-org-id` est volontairement ignoré (vecteur de spoofing).
 * Sans source d'org, le middleware fonctionne en "frontend gate" : clé validée, pas d'`activeOrgId`.
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
