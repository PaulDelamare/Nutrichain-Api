import { Router } from 'express';
import { mixedAuth } from '../../../../shared/middlewares/mixedAuth';
import { validateShipmentParams } from '../middlewares/validateShipment.middleware';
import { createShipmentController } from '../controllers/shipment.controller';
import { WRITE_ROLES } from '../../../identity/constants/roles.constants';

const router = Router();

/**
 * Endpoints pour la gestion des Expéditions (Shipments)
 * Isolation Multi-Tenant via mixedAuth
 */

// POST /api/logistics/shipments - Créer une expédition
router.post(
  '/logistics/shipments',
  mixedAuth(WRITE_ROLES),
  validateShipmentParams,
  createShipmentController
);

export default router;
