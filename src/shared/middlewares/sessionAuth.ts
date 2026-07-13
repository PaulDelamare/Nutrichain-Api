import { Request, Response, NextFunction } from 'express';
import { requireOrgRole } from '../../modules/identity/middlewares/requireOrgRole.middleware';
import { APIError } from '../utils/errorHandler/APIError';
import { ensureActiveOrg, hasUserSession } from './authGuards';

/**
 * Autorise une action **humaine** : session obligatoire, rôle TOUJOURS évalué.
 *
 * Une clé API ne peut pas s'y substituer, et ce n'est pas une précaution de principe : la clé est
 * compilée dans le bundle de l'application mobile (`EXPO_PUBLIC_API_KEY`). Quiconque installe
 * l'application peut l'extraire — elle n'est donc PAS un secret. Une clé identifie une
 * application ; elle n'autorise personne.
 *
 * Le middleware qu'elle remplace (`mixedAuth`) basculait en mode clé sur la seule présence d'un
 * en-tête — un en-tête choisi par l'appelant — et n'évaluait alors JAMAIS les rôles. Une clé
 * suffisait donc à créer des réceptions et à lire l'annuaire nominatif des salariés, sans compte.
 */
export const sessionAuth = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Message explicite : sans lui, un intégrateur qui n'envoie que sa clé reçoit un « non
    // authentifié » sibyllin et croit à une clé invalide, alors que c'est le MODÈLE qui a changé.
    if (req.headers['x-api-key'] && !hasUserSession(req)) {
      return next(
        new APIError(401, {
          error: [
            {
              field: 'auth',
              message:
                "Cette action requiert un utilisateur authentifié : une clé API ne l'autorise pas.",
            },
          ],
        })
      );
    }

    return requireOrgRole(allowedRoles)(req, res, ensureActiveOrg(req, next));
  };
};
