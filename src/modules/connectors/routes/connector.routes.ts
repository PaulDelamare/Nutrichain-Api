import { Router } from 'express';
import express from 'express';
import { mixedAuth } from '../../../shared/middlewares/mixedAuth';
import {
  importProductsController,
  exportEventsController,
} from '../controllers/connector.controller';

const router = Router();

/**
 * Connecteurs ERP/WMS/TMS (M2M ou session) — cloisonnés par organisation via `mixedAuth`.
 * Entrant : import de catalogue produit (CSV). Sortant : export des événements EPCIS (CSV).
 */
router.post(
  '/connectors/imports/products',
  express.text({ type: ['text/csv', 'text/plain', 'application/csv'], limit: '5mb' }),
  mixedAuth(['owner', 'admin']),
  importProductsController
);

router.get(
  '/connectors/exports/events',
  mixedAuth(['owner', 'admin', 'member']),
  exportEventsController
);

export default router;
