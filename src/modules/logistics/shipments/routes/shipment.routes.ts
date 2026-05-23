import { Router } from 'express';
import { mixedAuth } from '../../../../shared/middlewares/mixedAuth';
import { validateShipmentParams } from '../middlewares/validateShipment.middleware';
import { createShipmentController } from '../controllers/shipment.controller';

const router = Router();

/**
 * Endpoints pour la gestion des Expéditions (Shipments)
 * Isolation Multi-Tenant via mixedAuth
 */

// POST /api/logistics/shipments - Créer une expédition
router.post('/', mixedAuth, validateShipmentParams, createShipmentController);

export default router;
