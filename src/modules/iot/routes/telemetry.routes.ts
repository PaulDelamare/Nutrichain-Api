import { Router } from 'express';
import { ingestTelemetry, getSensorHistory } from '../controllers/telemetry.controller';
import { checkApiKey } from '../../../shared/utils/checkApiKey/checkApiKey';
import { mixedAuth } from '../../../shared/middlewares/mixedAuth';
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
 *     summary: Ingestion d'une trame de télémétrie capteur (IoT)
 *     description: |
 *       Persiste un point dans la collection MongoDB time-series puis déclenche
 *       **synchrone** la détection d'excursion thermique (Objectif SMART n°2,
 *       alerte chaîne du froid < 30s p95).
 *
 *       Side-effect détection :
 *       - Résout `Equipment` via `(sensor_id, organization_id)` (multi-tenant strict).
 *         Si le capteur n'est lié à aucun Equipment dans l'org bound par la clé API,
 *         l'ingest réussit (202) mais aucune alerte n'est créée (log warn server-side).
 *       - Si `temperature > Equipment.temp_seuil_max` et qu'au moins 5 points sur les
 *         15 dernières minutes dépassent le seuil avec un ratio ≥ 80%, crée une `Alert`
 *         de type `TEMP_EXCURSION` (niveau PANIC) et envoie un email aux owners/admins
 *         de l'org de l'Equipment.
 *       - Dédup : pas de doublon tant qu'une `Alert` ACTIVE existe pour cet équipement.
 *
 *       Voir `docs/15_iot_cold_chain_alerts.md` pour le flux complet.
 *     tags: [IoT]
 *     security:
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sensor_id, temperature, humidity, battery_level]
 *             properties:
 *               sensor_id:
 *                 type: string
 *                 description: Identifiant du capteur (doit matcher `Equipment.sensor_id` pour activer la détection)
 *                 example: "SENSOR-FRIGO-NORD-001"
 *               temperature:
 *                 type: number
 *                 description: Température en °C
 *                 example: 4.2
 *               humidity:
 *                 type: number
 *                 description: Humidité relative en %
 *                 example: 60
 *               battery_level:
 *                 type: integer
 *                 description: Niveau de batterie du capteur (0-100)
 *                 example: 85
 *     responses:
 *       202:
 *         description: |
 *           Trame acceptée et persistée. La détection d'excursion a tourné synchroniquement
 *           mais son résultat n'est pas exposé dans la réponse (consultable via `GET /api/alerts`).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: integer
 *                   example: 202
 *                 message:
 *                   type: string
 *                   example: "Telemetry ingested successfully."
 *                 data:
 *                   type: object
 *                   properties:
 *                     sensor_id:
 *                       type: string
 *       400:
 *         description: Payload invalide ou organisation manquante
 *       401:
 *         description: Clé API manquante ou invalide
 */
// Capteurs IoT : pas de session utilisateur, clé API obligatoire (M2M).
// mixedAuth([]) applique la garde multi-tenant centralisée : org résolue (API_KEY_ORG_ID)
// obligatoire, sinon 401 — pas de bypass de la politique cross-tenant.
router.post('/telemetry/ping', mixedAuth([]), ingestTelemetry);

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
