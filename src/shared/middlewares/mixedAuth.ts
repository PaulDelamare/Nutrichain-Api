import { Request, Response, NextFunction } from 'express';
import { checkApiKey } from '../utils/checkApiKey/checkApiKey';
import { requireOrgRole } from '../../modules/identity/middlewares/requireOrgRole.middleware';

/**
 * Middleware hybride qui vérifie soit une clé API (M2M), soit une session utilisateur avec rôle (Web).
 * Simplifie le routage en évitant les ternaires inline répétitifs.
 * 
 * @param allowedRoles Liste des rôles autorisés si authentification par session
 */
export const mixedAuth = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const hasApiKey = !!req.headers['x-api-key'];

    if (hasApiKey) {
      // Pour les robots/capteurs/scripts : Clé API
      return checkApiKey()(req, res, next);
    }

    // Pour les humains (Frontend) : Session + Rôle
    return requireOrgRole(allowedRoles)(req, res, next);
  };
};
