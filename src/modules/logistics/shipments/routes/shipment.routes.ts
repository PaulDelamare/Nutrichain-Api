import { Router } from 'express';
import { sessionAuth } from '../../../../shared/middlewares/sessionAuth';
import { validateShipmentParams } from '../middlewares/validateShipment.middleware';
import { createShipmentController } from '../controllers/shipment.controller';
import { WRITE_ROLES } from '../../../identity/constants/roles.constants';

const router = Router();

/**
 * Endpoints pour la gestion des Expéditions (Shipments)
 * Isolation Multi-Tenant via sessionAuth (session obligatoire, rôle évalué)
 */

// POST /api/logistics/shipments - Créer une expédition
/**
 * @swagger
 * /api/logistics/shipments:
 *   post:
 *     summary: Expédier des lots vers un client (agrégation SSCC)
 *     description: |
 *       Crée l'expédition, décrémente les lots, génère un **SSCC 18 chiffres** (unité logistique)
 *       et l'AggregationEvent EPCIS correspondant, le tout dans une seule transaction.
 *
 *       Un lot bloquant (`BLOQUE`, `EN_ATTENTE_QC`, `ALERTE`) ne peut pas être expédié : c'est la
 *       barrière sanitaire. `shipment_id: AUTO` fait générer la référence par le serveur.
 *     tags: [Logistique]
 *     security:
 *       - bearerAuth: []
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
 *                 minLength: 3
 *                 maxLength: 100
 *                 example: AUTO
 *               transporteur:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 100
 *               destination_adresse:
 *                 type: string
 *                 minLength: 5
 *                 maxLength: 255
 *               lots:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 500
 *                 description: Borné — une expédition de dizaines de milliers de lignes ouvrait une transaction géante
 *                 items:
 *                   type: object
 *                   required: [id_lot, quantite_expediee]
 *                   properties:
 *                     id_lot:
 *                       type: string
 *                       format: uuid
 *                     quantite_expediee:
 *                       type: number
 *                       description: Strictement positive
 *     responses:
 *       201:
 *         description: Expédition créée, SSCC généré
 *       400:
 *         description: Payload invalide, ou lot non expédiable (quarantaine, rappel, attente de contrôle)
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant
 *       404:
 *         description: Client ou lot introuvable dans l'organisation active
 *       409:
 *         description: |
 *           Référence d'expédition déjà utilisée, client archivé, ou conflit de verrou optimiste
 *           sur un lot modifié entre-temps — dans ce dernier cas, rejouer la requête.
 */
router.post(
  '/logistics/shipments',
  sessionAuth(WRITE_ROLES),
  validateShipmentParams,
  createShipmentController
);

export default router;
