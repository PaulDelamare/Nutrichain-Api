import { Router } from 'express';
import { requireAuth } from '../../identity/middlewares/requireAuth.middleware';
import { requireOrgRole } from '../../identity/middlewares/requireOrgRole.middleware';
import { ADMIN_ROLES } from '../../identity/constants/roles.constants';
import { observabilityMetricsController } from '../controllers/observabilityMetrics.controller';
import { observabilityDashboardController } from '../controllers/observabilityDashboard.controller';

const router = Router();

/**
 * @swagger
 * /api/observability/metrics:
 *   get:
 *     summary: Métriques d'observabilité de l'organisation active (JSON)
 *     description: |
 *       Latence par route (p50/p95/p99, ring buffer en mémoire depuis le dernier redémarrage),
 *       nombre d'entrées d'audit et alertes déclenchées sur les 24 dernières heures.
 *
 *       Réservé à owner/admin — ces compteurs révèlent l'activité opérationnelle complète de
 *       l'organisation (volume d'écritures auditées, alertes qualité/chaîne du froid).
 *     tags: [Observabilité]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Métriques calculées
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Rôle insuffisant (seuls owner / admin)
 */
router.get('/observability/metrics', requireAuth, requireOrgRole(ADMIN_ROLES), observabilityMetricsController);

/**
 * @swagger
 * /api/observability/dashboard:
 *   get:
 *     summary: Tableau de bord d'observabilité (page HTML)
 *     description: |
 *       Même données que `/api/observability/metrics`, rendues en HTML pour consultation directe.
 *       Réservé à owner/admin.
 *     tags: [Observabilité]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Page HTML
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Rôle insuffisant (seuls owner / admin)
 */
router.get(
  '/observability/dashboard',
  requireAuth,
  requireOrgRole(ADMIN_ROLES),
  observabilityDashboardController
);

export default router;
