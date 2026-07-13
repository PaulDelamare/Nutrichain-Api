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
router.post(
  '/logistics/shipments',
  sessionAuth(WRITE_ROLES),
  validateShipmentParams,
  createShipmentController
);

export default router;
