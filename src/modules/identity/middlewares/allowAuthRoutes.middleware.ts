import { Request, Response, NextFunction } from 'express';
import { APIError } from '../../../shared/utils/errorHandler/APIError';

/**
 * Ferme le passthrough Better-Auth par ALLOWLIST : seuls les flux d'authentification réellement
 * utilisés par les clients passent, tout le reste du core est refusé en 403.
 *
 * `router.all('/auth/*')` transmet TOUT le core Better-Auth à `toNodeHandler(auth)` sans traverser
 * notre RBAC ni l'audit WORM : `update-user`, `delete-user`, `change-email`, `change-password`, la
 * gestion des sessions (`get-session`, `list-sessions`, `revoke-session`), le reset de mot de passe,
 * la 2FA… La seule barrière est la clé API — compilée dans le bundle mobile, donc pas un secret.
 * `blockOrgPassthrough` a fermé `/auth/organization/*` ; celui-ci ferme le reste.
 *
 * On liste ce qui est AUTORISÉ plutôt que ce qui est interdit : une blocklist dériverait à chaque
 * version de Better-Auth (nouvel endpoint = trou rouvert en silence), une allowlist échoue fermé.
 *
 * Audit des deux clients (front SvelteKit + mobile Expo) : ils n'appellent que ces trois routes, en
 * POST. La session se lit via `/api/me` (route à nous), jamais via `get-session`. La 2FA n'est
 * utilisée par aucun client (le mobile la refuse même explicitement).
 */
const ALLOWED_AUTH_ROUTES: Record<string, 'POST'> = {
  '/auth/sign-in/email': 'POST',
  '/auth/sign-up/email': 'POST',
  '/auth/sign-out': 'POST',
};

export const allowAuthRoutes = (req: Request, _res: Response, next: NextFunction): void => {
  if (ALLOWED_AUTH_ROUTES[req.path] === req.method) return next();

  next(
    new APIError(403, {
      error: [
        {
          field: 'auth',
          message:
            "Cette route d'authentification n'est pas exposée : elle contournerait le contrôle des rôles et l'audit. Seules la connexion, l'inscription et la déconnexion sont accessibles.",
        },
      ],
    })
  );
};
