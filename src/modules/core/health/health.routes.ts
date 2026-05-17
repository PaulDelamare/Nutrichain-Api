// ! IMPORTS
import { router } from '../../../shared/configs/router.config';
import { HealthController } from '../health.controller';

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Vérifie si l'API est en ligne (Liveness)
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: L'API est en ligne
 */
// ! Liveness
router.get('/health', HealthController.health);

/**
 * @swagger
 * /api/health/ready:
 *   get:
 *     summary: Vérifie si l'API est prête à recevoir du trafic (Readiness, DB connectée)
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: L'API et ses dépendances sont prêtes
 *       503:
 *         description: Service indisponible (Erreur base de données, etc.)
 */
// ! Readiness
router.get('/health/ready', HealthController.readiness);

export default router;
