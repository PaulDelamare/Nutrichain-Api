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

// POST /api/logistics/shipments - Créer une expédition
router.post(
  '/logistics/shipments',
  mixedAuth(LOGISTICS_WRITE_ROLES),
  validateShipmentParams,
  createShipmentController
);

export default router;
