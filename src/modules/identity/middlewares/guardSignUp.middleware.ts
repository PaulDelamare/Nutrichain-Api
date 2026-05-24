import { Request, Response, NextFunction } from 'express';
import { bdd } from '../../../shared/configs/prismaClient.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';

/**
 * Middleware métier pour sécuriser la création de compte au strict minimum.
 * Un compte ne peut être créé QUE SI :
 * 1. La base de données est vide (0 utilisateurs), on l'accepte (pour créer le "First Admin").
 * 2. OU l'email qui essaie de s'inscrire possède une Invitation valide dans la base de données.
 */
export const requireInvitationOrFirstUser = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const email = req.body?.email;
    if (!email) {
      throw new APIError(400, {
        error: [{ field: 'email', message: "L'adresse email est requise." }],
      });
    }

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
          gt: new Date(),
        },
      },
    });

    if (!invitation) {
      throw new APIError(403, {
        error: [
          {
            field: 'auth',
            message:
              "Création de compte refusée. Vous n'avez pas d'invitation valide ou elle a expiré.",
          },
        ],
      });
    }

    next();
  }
);
