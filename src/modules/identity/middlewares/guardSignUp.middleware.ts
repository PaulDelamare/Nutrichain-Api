import { Request, Response, NextFunction } from 'express';
import { bdd } from '../../../shared/configs/prismaClient.config';

/**
 * Middleware métier pour sécuriser la création de compte au strict minimum.
 * Un compte ne peut être créé QUE SI :
 * 1. La base de données est vide (0 utilisateurs), on l'accepte (pour créer le "First Admin").
 * 2. OU l'email qui essaie de s'inscrire possède une Invitation valide dans la base de données.
 */
export const requireInvitationOrFirstUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const email = req.body?.email;
    if (!email) {
      res.status(400).json({ status: 400, message: "L'email est requis." });
      return;
    }

    // Compter le nombre de membres
    const userCount = await bdd.user.count();

    // 1. Bypass si c'est la toute première personne du système
    if (userCount === 0) {
      return next();
    }

    // 2. Sinon, on cherche une invitation Active/Pending pour cet email
    const invitation = await bdd.invitation.findFirst({
      where: {
        email: email,
        status: 'pending',
        expiresAt: {
          gt: new Date(), // l'invitation ne doit pas être expirée
        },
      },
    });

    if (!invitation) {
      res.status(403).json({
        status: 403,
        message:
          "Création de compte refusée. Vous n'avez pas d'Invitation valide ou elle a expiré.",
      });
      // ! On coupe le flux ICI pour que Better Auth n'aille jamais en DB
      return;
    }

    // On est bon, la personne a le droit de s'inscrire ! (Dans un flow complet, il faudrait supprimer/marquer l'invitation confirmée après)
    next();
  } catch (error) {
    console.error('[SignUp Guard Error]', error);
    res.status(500).json({ status: 500, message: 'Internal Auth Guard Error' });
  }
};
