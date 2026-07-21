import { Router } from 'express';
import { ingestTelemetry, getSensorHistory } from '../controllers/telemetry.controller';
import { checkApiKey } from '../../../shared/utils/checkApiKey/checkApiKey';
import { machineAuth } from '../../../shared/middlewares/machineAuth';
import { requireAuth } from '../../identity/middlewares/requireAuth.middleware';
import { requireOrgRole } from '../../identity/middlewares/requireOrgRole.middleware';
import { ALL_ROLES } from '../../identity/constants/roles.constants';

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
 *       L'organisation vient de la **passerelle** (`IotGateway`) qui présente la clé, jamais d'une
 *       variable d'environnement ni d'un en-tête : une clé inconnue ou révoquée reçoit un 401.
 *
 *       Side-effect détection :
 *       - Résout `Equipment` via `(sensor_id, organization_id)` (multi-tenant strict).
 *         Si le capteur n'est lié à aucun Equipment dans l'org de la passerelle, l'ingest réussit
 *         (202) mais aucune alerte n'est possible : la réponse le dit (`detection`), et un warn
 *         est loggué côté serveur.
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
 *                     detection:
 *                       type: string
 *                       enum: [MONITORED, NO_EQUIPMENT, NO_THRESHOLD]
 *                       description: |
 *                         Ce que la surveillance a pu faire de la trame. `NO_EQUIPMENT` = capteur
 *                         non rattaché à un matériel, `NO_THRESHOLD` = matériel sans seuil : dans
 *                         les deux cas aucune excursion ne peut être détectée.
 *       400:
 *         description: Payload invalide
 *       401:
 *         description: Passerelle IoT inconnue ou révoquée
 */
// La SEULE route ouverte à une machine : un capteur ne peut pas ouvrir de session humaine.
// Elle n'ingère que des mesures — aucune décision, aucune identité d'auteur (cf. machineAuth).
router.post('/telemetry/ping', machineAuth(), ingestTelemetry);

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
  requireOrgRole(ALL_ROLES),
  getSensorHistory
);

export default router;
