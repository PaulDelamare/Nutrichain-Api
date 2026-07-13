import { router } from '../../shared/configs/router.config';
import { HelloController } from './hello.controller';
import { checkApiKey } from '../../shared/utils/checkApiKey/checkApiKey';
import { requireAuth } from '../identity/middlewares/requireAuth.middleware';
import { Response } from 'express';
import { sendSuccess } from '../../shared/utils/returnSuccess/returnSuccess';
import { AuthenticatedRequest } from '../identity/types/auth.types';

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
 *         description: Informations de session récupérées avec succès
 *       401:
 *         description: Non authentifié
 */
// Route de test protégée par Better-Auth !
router.get('/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  sendSuccess(res, 200, 'Authentification réussie !', {
    user: req.auth?.user,
    session: req.auth?.session,
    activeOrgId: req.activeOrgId
  });
});

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
