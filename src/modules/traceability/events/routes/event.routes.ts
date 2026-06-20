import { Router } from 'express';
import { listEventsController } from '../controllers/event.controller';
import { validateEventsQuery } from '../middlewares/validateEventsQuery.middleware';
import { mixedAuth } from '../../../../shared/middlewares/mixedAuth';

const router = Router();

// Lecture autorisée aux rôles org (session) ou via clé API (M2M, ex: connecteurs ERP)
const READ_ROLES = ['owner', 'admin', 'member'];

/**
 * @swagger
 * /api/traceability/events:
 *   get:
 *     summary: Lister les événements EPCIS de l'organisation (restitution GS1)
 *     description: Liste paginée et cloisonnée par organisation. Filtres optionnels event_type et related_entity.
 *     tags: [Traçabilité]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: event_type
 *         schema:
 *           type: string
 *       - in: query
 *         name: related_entity
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Liste des événements EPCIS
 */
router.get(
  '/traceability/events',
  mixedAuth(READ_ROLES),
  validateEventsQuery,
  listEventsController
);

export default router;
