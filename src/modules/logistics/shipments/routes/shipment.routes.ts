import { Router } from 'express';
import { mixedAuth } from '../../../../shared/middlewares/mixedAuth';
import { validateShipmentParams } from '../middlewares/validateShipment.middleware';
import { createShipmentController } from '../controllers/shipment.controller';
import { LOGISTICS_ROLES } from '../../constants/logistics.constants';

const router = Router();

const LOGISTICS_WRITE_ROLES = [
  LOGISTICS_ROLES.OPERATOR,
  LOGISTICS_ROLES.ADMIN,
  LOGISTICS_ROLES.OWNER,
];

/**
 * Endpoints pour la gestion des Expéditions (Shipments)
 * Isolation Multi-Tenant via mixedAuth
 */

/**
 * @swagger
 * /api/logistics/shipments:
 *   post:
 *     summary: Créer une expédition à partir d'un ou plusieurs lots
 *     description: >
 *       Décrémente le stock des lots expédiés et crée une `Shipment` rattachée à un client.
 *       Accessible via session web (rôles logistiques en écriture) ou clé API (M2M).
 *     tags: [Logistique]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id_client, shipment_id, transporteur, destination_adresse, lots]
 *             properties:
 *               id_client:
 *                 type: string
 *                 format: uuid
 *               shipment_id:
 *                 type: string
 *               transporteur:
 *                 type: string
 *               destination_adresse:
 *                 type: string
 *               created_by:
 *                 type: string
 *                 format: uuid
 *                 description: Fallback en mode clé API (M2M)
 *               lots:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [id_lot, quantite_expediee]
 *                   properties:
 *                     id_lot:
 *                       type: string
 *                       format: uuid
 *                     quantite_expediee:
 *                       type: number
 *                       description: Quantité expédiée (strictement positive)
 *     responses:
 *       201:
 *         description: Expédition créée avec succès
 *       400:
 *         description: Payload invalide ou stock insuffisant
 *       401:
 *         description: Non authentifié ou clé API manquante
 *       403:
 *         description: Rôle insuffisant
 *       404:
 *         description: Client ou lot introuvable
 */
// POST /api/logistics/shipments - Créer une expédition
router.post(
  '/logistics/shipments',
  mixedAuth(LOGISTICS_WRITE_ROLES),
  validateShipmentParams,
  createShipmentController
);

export default router;
