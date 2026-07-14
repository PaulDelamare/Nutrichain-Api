import { Response, NextFunction } from 'express';
import { auth } from '../auth.config';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { AuthenticatedRequest, AuthUser, AuthSession } from '../types/auth.types';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';

/**
 * Autorise une action de PLATEFORME (personnel NutriChain), au-dessus des organisations.
 *
 * Contrairement à `requireOrgRole`, il n'exige PAS d'organisation active : l'administrateur de
 * plateforme n'est membre d'aucune organisation. C'est précisément ce qui l'empêche d'atteindre les
 * données métier — toutes les routes `/organization/*` et `/logistics/*` passent par `ensureActiveOrg`
 * et le rejettent faute d'org active. On ne lui ouvre donc AUCUNE porte sur les données clientes ;
 * il ne dispose que des routes `/platform/*`.
 *
 * Ne jamais transformer ce middleware en dérogation à l'intérieur de `requireOrgRole` : ce serait un
 * chemin d'accès transverse à tous les tenants.
 */
export const requirePlatformAdmin = catchAsync(
  async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    const sessionPayload = await auth.api.getSession({
      headers: new Headers(req.headers as Record<string, string>),
    });

    if (!sessionPayload?.session || !sessionPayload.user) {
      throw new APIError(401, {
        error: [{ field: 'auth', message: 'Accès refusé. Veuillez vous authentifier.' }],
      });
    }

    const platformAdmin = await prisma.platformAdmin.findUnique({
      where: { userId: sessionPayload.user.id },
    });

    if (!platformAdmin) {
      throw new APIError(403, {
        error: [
          { field: 'auth', message: 'Action réservée aux administrateurs de la plateforme.' },
        ],
      });
    }

    // Volontairement SANS activeOrgId : il ne doit pouvoir toucher aucune donnée d'organisation.
    req.auth = {
      user: sessionPayload.user as AuthUser,
      session: sessionPayload.session as AuthSession,
    };

    next();
  }
);
