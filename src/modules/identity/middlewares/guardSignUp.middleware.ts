import { Request, Response, NextFunction } from 'express';
import { bdd } from '../../../shared/configs/prismaClient.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';

/**
 * Middleware métier pour sécuriser la création de compte.
 *
 * Un compte ne peut être créé QUE SI :
 *  1. La base de données est vide (0 utilisateurs) — bypass "First Admin" pour bootstrap.
 *  2. OU une `Invitation` pending non-expirée existe pour cet `email` ET le `token` fourni
 *     correspond strictement à `invitation.id`. Le token est obligatoire dès qu'au moins
 *     un utilisateur existe.
 *
 * Sécurité :
 * - Les messages d'erreur sont volontairement génériques pour ne pas révéler si un email
 *   donné a été invité (anti-enumeration).
 * - Pas de retro-compat sur l'absence du token : un attaquant qui devine un email d'employé
 *   ne peut pas downgrade en omettant le token.
 */
export const requireInvitationOrFirstUser = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const body = req.body as { email?: unknown; token?: unknown } | undefined;
    const email = typeof body?.email === 'string' ? body.email : undefined;
    const token = typeof body?.token === 'string' ? body.token : undefined;

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

    // 2. On cherche une invitation pending non-expirée correspondant à (id, email).
    // Le filtre sur les deux champs simultanément empêche un attaquant de combiner un
    // token réel avec un email arbitraire.
    //
    // Anti-enumeration : si le token est absent on lance quand même la requête avec un
    // UUID qui ne matche jamais. Comme ça les 3 branches d'échec (pas de token / token
    // bidon / email-token incohérents) prennent le même temps DB côté serveur — un
    // attaquant ne peut pas distinguer "email connu sans token" de "email inconnu" par
    // timing.
    const DUMMY_TOKEN = '00000000-0000-0000-0000-000000000000';
    // `||` (et pas `??`) pour traiter aussi empty string comme absent,
    // sinon `id: ''` créerait une 4e branche de timing.
    const invitation = await bdd.invitation.findFirst({
      where: {
        id: token || DUMMY_TOKEN,
        email,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
    });

    if (!invitation) {
      throw new APIError(403, {
        error: [
          {
            field: 'auth',
            // Message identique aux autres branches d'échec (anti-enumeration).
            message:
              "Création de compte refusée. Vous n'avez pas d'invitation valide ou elle a expiré.",
          },
        ],
      });
    }

    next();
  }
);
