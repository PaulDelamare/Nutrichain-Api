import { Request, Response, NextFunction } from 'express';
import { APIError } from '../../../shared/utils/errorHandler/APIError';

/**
 * Ferme le sous-arbre `/auth/organization/*` du plugin Better-Auth.
 *
 * `router.all('/auth/*')` est un passthrough TOTAL vers Better-Auth : tout le plugin
 * `organization` était donc joignable — `create`, `delete`, `update`, `set-active`,
 * `invite-member`, `remove-member`, `update-member-role`, les rôles dynamiques, les teams.
 *
 * Ces routes ne traversent JAMAIS notre RBAC (`sessionAuth` / `requireOrgRole`) et n'écrivent RIEN
 * dans l'audit WORM. Deux conséquences, l'une vérifiée en HTTP réel avant ce correctif :
 *
 *  1. `POST /auth/organization/create` répondait 200 à un `viewer` — le rôle en LECTURE SEULE —
 *     qui devenait `owner` de l'organisation ainsi créée, puis pouvait y basculer sa session
 *     (`set-active`) et inviter qui il voulait. La clé API exigée est compilée dans le bundle du
 *     mobile : ce n'est pas un secret (cf. `sessionAuth`).
 *  2. `POST /auth/organization/delete` supprime l'organisation EN CASCADE — membres, lots… et le
 *     journal d'audit WORM avec. Un journal inviolable effaçable par une route non tracée.
 *
 * On bloque le sous-arbre ENTIER plutôt qu'une liste d'actions : une liste dériverait à la
 * prochaine version de Better-Auth, et le trou se rouvrirait en silence. La gestion des
 * organisations et des membres passe par nos routes à nous, gardées et journalisées.
 *
 * L'API continue d'utiliser le plugin côté serveur (`auth.api.getFullOrganization`) : ces appels
 * sont en processus, ils ne traversent pas ce routeur.
 */
export const blockOrgPassthrough = (req: Request, _res: Response, next: NextFunction): void => {
  if (!/^\/auth\/organization(\/|$)/.test(req.path)) return next();

  next(
    new APIError(403, {
      error: [
        {
          field: 'auth',
          message:
            "La gestion des organisations et des membres ne passe pas par cette route : elle contournerait le contrôle des rôles et l'audit. Utilisez les routes de l'API NutriChain.",
        },
      ],
    })
  );
};
