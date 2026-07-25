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
 * Audit des deux clients (front SvelteKit + mobile Expo) : ils n'appellent que ces routes, en
 * POST. La session se lit via `/api/me` (route à nous), jamais via `get-session`.
 *
 * 2FA (TOTP) : seul le sous-ensemble réellement enrôlé côté client est ouvert — enable/
 * get-totp-uri/verify-totp/disable. `verify-totp` sert deux fois (confirmation d'enrôlement ET
 * étape de connexion après `twoFactorRedirect`) : c'est le même endpoint Better-Auth des deux
 * côtés. Les codes de secours (`generate-backup-codes`, `verify-backup-code`) et l'OTP par
 * e-mail/SMS restent fermés : aucun client n'implémente ce parcours de repli (cf. #127).
 */
const ALLOWED_AUTH_ROUTES: Record<string, 'POST'> = {
  '/auth/sign-in/email': 'POST',
  '/auth/sign-up/email': 'POST',
  '/auth/sign-out': 'POST',
  '/auth/two-factor/enable': 'POST',
  '/auth/two-factor/get-totp-uri': 'POST',
  '/auth/two-factor/verify-totp': 'POST',
  '/auth/two-factor/disable': 'POST',
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
