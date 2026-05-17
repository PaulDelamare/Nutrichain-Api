import { Router } from 'express';
import { ingestTelemetry, getSensorHistory } from '../controllers/telemetry.controller';
import { checkApiKey } from '../../../shared/utils/checkApiKey/checkApiKey';
import { requireAuth } from '../../identity/middlewares/requireAuth.middleware';
import { requireOrgRole } from '../../identity/middlewares/requireOrgRole.middleware';

const router = Router();

// ==========================================
// SÉCURITÉ
// ==========================================

/**
 * @swagger
 * /api/telemetry/ping:
 *   post:
 *     summary: Ingestion des données de télémétrie des capteurs (IoT)
 *     tags: [IoT]
 *     security:
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sensor_id:
 *                 type: string
 *               temperature:
 *                 type: number
 *               humidity:
 *                 type: number
 *               battery_level:
 *                 type: number
 *     responses:
 *       202:
 *         description: Trame de télémétrie acceptée
 *       401:
 *         description: Clé API manquante ou invalide
 */
// Les capteurs IoT envoient des Pings sans session utilisateur (Pas de requireAuth),
// MAIS ils doivent obligatoirement présenter la clé d'API certifiée de l'usine (MToM).
router.post('/telemetry/ping', checkApiKey(), ingestTelemetry);

/**
 * @swagger
 * /api/telemetry/{sensor_id}/history:
 *   get:
 *     summary: Récupérer l'historique d'un capteur spécifique
 *     tags: [IoT]
 *     security:
 *       - apiKeyAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sensor_id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID du capteur
 *     responses:
 *       200:
 *         description: Historique récupéré avec succès
 *       401:
 *         description: Non authentifié ou clé API manquante
 *       403:
 *         description: Accès refusé (rôle insuffisant ou organisation non sélectionnée)
 */
// La lecture de l'historique est effectuée par le Frontend (Humain),
// il faut l'API Key, une session validée, et appartenir à l'organisation active minimum en tant que membre.
router.get(
  '/telemetry/:sensor_id/history',
  checkApiKey(),
  requireAuth,
  requireOrgRole(['owner', 'admin', 'member']),
  getSensorHistory
);

export default router;
