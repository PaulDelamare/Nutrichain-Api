import { createHmac } from 'crypto';
import { Response, NextFunction } from 'express';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { logger } from '../../../shared/utils/logger/logger';
import { AuthenticatedRequest } from '../types/auth.types';

/** Échecs tolérés avant verrouillage. */
export const MAX_FAILED_ATTEMPTS = 5;
/** Fenêtre de comptage : au-delà, les échecs anciens ne comptent plus. */
export const WINDOW_MINUTES = 15;
/** Durée du verrou une fois le seuil atteint. */
export const LOCK_MINUTES = 15;

const minutes = (n: number) => n * 60 * 1000;

/**
 * L'e-mail ne sert que de clé : on n'en garde qu'une empreinte, calculée en HMAC avec le secret du
 * serveur. Un SHA-256 nu serait forçable au dictionnaire — l'espace des adresses d'une entreprise
 * s'énumère en quelques secondes. Avec le secret, la table reste inexploitable pour qui la lirait
 * sans lui. Elle demeure néanmoins une donnée PSEUDONYMISÉE, donc une donnée personnelle : c'est le
 * job de purge qui la borne dans le temps, pas cette empreinte.
 */
const hashEmail = (email: string): string =>
  createHmac('sha256', process.env.BETTER_AUTH_SECRET ?? 'nutrichain-login-throttle')
    .update(email.trim().toLowerCase())
    .digest('hex');

/**
 * Verrouillage temporaire d'un COMPTE après des échecs répétés.
 *
 * Le limiteur par IP ne protège pas un compte ciblé : qui dispose de plusieurs adresses le
 * contourne sans effort. Cette garde-ci porte sur le compte, et les deux couches se complètent —
 * l'une freine le balayage de comptes depuis une source, l'autre l'acharnement sur une victime.
 *
 * ⚠️ On compte la tentative AVANT de la laisser passer, et on efface le compteur si elle réussit.
 * L'inverse — compter au vu de la réponse — a été mesuré défaillant sur deux points : le décompte
 * se perdait quand le client coupait la connexion (`finish` n'est jamais émis, donc échec gratuit),
 * et surtout huit tentatives simultanées lisaient toutes le même compteur avant de le réécrire :
 * neuf échecs n'en valaient que deux, et l'attaque par salves passait à travers. L'incrément est
 * donc atomique et pris en compte quoi qu'il advienne ensuite.
 *
 * Compromis assumé : qui connaît une adresse peut la verrouiller 15 minutes. C'est le prix standard
 * de cette protection ; la fenêtre est courte, et un verrouillage définitif serait bien pire ici,
 * puisque la réinitialisation de mot de passe n'est pas exposée.
 */
export const loginThrottle = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const email = req.body?.email;
    if (typeof email !== 'string' || email.trim() === '') {
      // Corps invalide : ce n'est pas à cette garde de le dire.
      return next();
    }

    const emailHash = hashEmail(email);
    const now = new Date();

    // Incrément ATOMIQUE (`ON CONFLICT DO UPDATE ... failed_count + 1` côté PostgreSQL) : deux
    // tentatives concurrentes ne peuvent pas s'écraser l'une l'autre.
    const attempt = await prisma.loginAttempt.upsert({
      where: { email_hash: emailHash },
      create: { email_hash: emailHash, failed_count: 1, first_failed_at: now },
      update: { failed_count: { increment: 1 } },
    });

    if (attempt.locked_until && attempt.locked_until > now) {
      throw activeLock(attempt.locked_until, now);
    }

    const windowExpired = now.getTime() - attempt.first_failed_at.getTime() > minutes(WINDOW_MINUTES);

    if (windowExpired) {
      // Le verrou précédent est retombé : on repart d'une ardoise vierge plutôt que de laisser un
      // compteur ancien re-verrouiller au premier échec suivant.
      await prisma.loginAttempt.update({
        where: { email_hash: emailHash },
        data: { failed_count: 1, first_failed_at: now, locked_until: null },
      });
    } else if (attempt.failed_count >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date(now.getTime() + minutes(LOCK_MINUTES));
      await prisma.loginAttempt.update({
        where: { email_hash: emailHash },
        data: { locked_until: lockedUntil },
      });
      throw activeLock(lockedUntil, now);
    }

    // Succès : l'ardoise est effacée. En cas d'échec, l'incrément déjà écrit fait foi.
    res.once('finish', () => {
      if (res.statusCode >= 400) return;

      void prisma.loginAttempt
        .deleteMany({ where: { email_hash: emailHash } })
        .catch((e) => logger.error('[loginThrottle] Remise à zéro impossible', e));
    });

    next();
  }
);

const activeLock = (lockedUntil: Date, now: Date): APIError => {
  const remaining = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 60000));

  return new APIError(429, {
    error: [
      {
        field: 'auth',
        message: `Trop de tentatives de connexion. Réessayez dans ${remaining} minute${remaining > 1 ? 's' : ''}.`,
      },
    ],
  });
};
