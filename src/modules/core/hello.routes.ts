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

/**
 * @swagger
 * /api/service:
 *   post:
 *     summary: Exemple de route appelant un service (Nécessite Clé API)
 *     tags: [Core]
 *     security:
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Succès
 *       401:
 *         description: Clé API manquante ou invalide
 */
router.post('/service', checkApiKey(), HelloController.serviceExemple);

// ! EXPORT
export default router;
