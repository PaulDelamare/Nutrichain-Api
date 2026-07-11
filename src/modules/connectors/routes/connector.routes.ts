import { Router } from 'express';
import express from 'express';
import { mixedAuth } from '../../../shared/middlewares/mixedAuth';
import { ALL_ROLES, ADMIN_ROLES } from '../../identity/constants/roles.constants';
import {
  importProductsController,
  importCustomersController,
  exportEventsController,
} from '../controllers/connector.controller';

const CSV_BODY = express.text({
  type: ['text/csv', 'text/plain', 'application/csv'],
  limit: '5mb',
});

const router = Router();

/**
 * Connecteurs ERP/WMS/TMS (M2M ou session) — cloisonnés par organisation via `mixedAuth`.
 * Entrant : import de catalogue produit (CSV). Sortant : export des événements EPCIS (CSV).
 */
router.post(
  '/connectors/imports/products',
  CSV_BODY,
  mixedAuth(ADMIN_ROLES),
  importProductsController
);

router.post(
  '/connectors/imports/customers',
  CSV_BODY,
  mixedAuth(ADMIN_ROLES),
  importCustomersController
);

router.get('/connectors/exports/events', mixedAuth(ALL_ROLES), exportEventsController);

export default router;
