import { Router } from 'express';
import { mixedAuth } from '../../../shared/middlewares/mixedAuth';
import { validateOrganizationQuery } from '../middlewares/validateOrganizationQuery.middleware';
import {
  listAlertsController,
  listAuditLogsController,
  listCustomersController,
  listEquipmentController,
  listMembersController,
  listMovementsController,
  listQualityControlsController,
  listQuarantineBatchesController,
  listShipmentsController,
  listSuppliersController,
} from '../controllers/organization.controller';

const router = Router();

// Lectures seules, cloisonnées par organisation — session web ou clé API (mixedAuth).
const READ_ROLES = ['owner', 'admin', 'member'];

router.get('/organization/members', mixedAuth(READ_ROLES), listMembersController);
router.get('/organization/alerts', mixedAuth(READ_ROLES), listAlertsController);
router.get(
  '/organization/audit-logs',
  mixedAuth(READ_ROLES),
  validateOrganizationQuery,
  listAuditLogsController
);
router.get('/organization/quality-controls', mixedAuth(READ_ROLES), listQualityControlsController);
router.get(
  '/organization/quarantine-batches',
  mixedAuth(READ_ROLES),
  listQuarantineBatchesController
);
router.get('/organization/equipment', mixedAuth(READ_ROLES), listEquipmentController);
router.get(
  '/organization/movements',
  mixedAuth(READ_ROLES),
  validateOrganizationQuery,
  listMovementsController
);
router.get('/organization/suppliers', mixedAuth(READ_ROLES), listSuppliersController);
router.get('/organization/customers', mixedAuth(READ_ROLES), listCustomersController);
router.get('/organization/shipments', mixedAuth(READ_ROLES), listShipmentsController);

export default router;
