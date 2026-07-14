import { router } from '../../shared/configs/router.config';
import { HelloController } from './hello.controller';
import { requireAuth } from '../identity/middlewares/requireAuth.middleware';
import { Response } from 'express';
import { sendSuccess } from '../../shared/utils/returnSuccess/returnSuccess';
import { AuthenticatedRequest } from '../identity/types/auth.types';
import { resolveActiveOrgRole } from '../identity/utils/resolveActiveOrgRole';
import { prisma } from '../../shared/configs/prismaClient.config';
import { catchAsync } from '../../shared/utils/errorHandler/catchAsync';

// ! Requêtes

/**
 * @swagger
 * /api/hello:
 *   get:
 *     summary: Route de test public (Hello World)
 *     tags: [Core]
 *     responses:
 *       200:
 *         description: Retourne un message de bienvenue
 */
router.get('/hello', HelloController.helloWorld);

/**
 * @swagger
 * /api/me:
 *   get:
 *     summary: Récupérer les informations de la session courante
 *     tags: [Core]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: |
 *           Session courante. `role` est le rôle de l'appelant dans son organisation active
 *           (`owner` | `admin` | `quality` | `operator` | `viewer`), ou `null` s'il n'a pas
 *           d'organisation active, s'il n'en est pas membre, ou si son rôle est hors référentiel.
 *           Il permet à l'interface de n'exposer que les actions autorisées ; l'autorisation
 *           réelle reste évaluée par `requireOrgRole` à chaque appel.
 *       401:
 *         description: Non authentifié
 */
// Route de test protégée par Better-Auth !
router.get(
  '/me',
  requireAuth,
  catchAsync(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.auth?.user?.id;

    // En parallèle : rôle dans l'org active (métier) et appartenance à la plateforme (gouvernance).
    // Les deux sont indépendants — un admin de plateforme n'a pas d'org active, donc pas de rôle.
    const [role, platformAdmin] = userId
      ? await Promise.all([
          resolveActiveOrgRole(userId, req.activeOrgId),
          prisma.platformAdmin.findUnique({ where: { userId }, select: { id: true } }),
        ])
      : [null, null];

    sendSuccess(res, 200, 'Authentification réussie !', {
      user: req.auth?.user,
      session: req.auth?.session,
      activeOrgId: req.activeOrgId,
      role,
      isPlatformAdmin: platformAdmin !== null,
    });
  })
);

/**
 * @swagger
 * /api/error:
 *   post:
 *     summary: Déclencher une erreur pour tester le ErrorHandler global
 *     tags: [Core]
 *     responses:
 *       500:
 *         description: Erreur générée
 */
router.post('/error', HelloController.errorRequest);

// `POST /api/service` (exemple de démonstration, ouvert à la seule clé API) a été supprimé :
// aucun appelant, et une surface d'attaque de plus pour rien.

// ! EXPORT
export default router;
