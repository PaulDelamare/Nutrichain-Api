import { Request, Response, NextFunction } from 'express';
import { auth } from '../auth.config';

/**
 * Middleware pour Exiger un Rôle Spécifique au sein de l'Organisation active.
 * Utile pour empêcher un simple "member" (ex: capteur IoT) de modifier un Produit ou inviter.
 *
 * @param allowedRoles Liste des rôles autorisés (ex: ['owner', 'admin'])
 */
export const requireOrgRole = (allowedRoles: ('owner' | 'admin' | 'member')[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Demande à Better-Auth la session actuelle via les entêtes de requête (Token)
      const session = await auth.api.getSession({
        headers: new Headers(req.headers as Record<string, string>),
      });

      if (!session || !session.session || !session.user) {
        res.status(401).json({ status: 401, message: 'Non authentifié' });
        return;
      }

      const activeOrgId = session.session.activeOrganizationId;

      if (!activeOrgId) {
        res.status(400).json({
          status: 400,
          message: "Vous n'avez pas sélectionné d'Organisation (Lieu) active.",
        });
        return;
      }

      // Récupère les infos de l'utilisateur sur cette organisation précise
      const orgDetails = await auth.api.getFullOrganization({
        headers: new Headers(req.headers as Record<string, string>),
        query: {
          organizationId: activeOrgId,
        },
      });

      if (!orgDetails) {
        res
          .status(403)
          .json({ status: 403, message: 'Vous ne faites plus partie de cette usine/ferme.' });
        return;
      }

      // Trouver le rôle de l'user courant dans cette orga
      const memberDetails = orgDetails.members.find((m) => m.userId === session.user.id);

      if (!memberDetails || !allowedRoles.includes(memberDetails.role as any)) {
        res.status(403).json({
          status: 403,
          message: `Action refusée. Votre rôle (${memberDetails?.role}) n'est pas autorisé. Requis: ${allowedRoles.join(' ou ')}.`,
        });
        return;
      }

      // Injecter les données d'authentification et d'organisation pour les contrôleurs
      (req as any).auth = {
        activeOrgId,
        user: session.user,
        role: memberDetails.role,
        session: session.session
      };

      // Si le rôle est validé, on passe à la route (le contrôleur) !
      next();
    } catch (error) {
      console.error('[RequireRole Guard]', error);
      res
        .status(500)
        .json({ status: 500, message: 'Erreur serveur lors de la vérification du rôle.' });
    }
  };
};
