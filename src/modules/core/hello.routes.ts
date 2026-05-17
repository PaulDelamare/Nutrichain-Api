// ! IMPORTS
import { router } from '../../shared/configs/router.config';
import { HelloController } from './hello.controller';
import { checkApiKey } from '../../shared/utils/checkApiKey/checkApiKey';
import { requireAuth } from '../identity/middlewares/requireAuth.middleware';
import { Request, Response } from 'express';

// ! RequÃªtes

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
router.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json({
    message: 'Authentification réussie !',
    user: (req as unknown as { user: unknown }).user,
    session: (req as unknown as { session: unknown }).session,
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
