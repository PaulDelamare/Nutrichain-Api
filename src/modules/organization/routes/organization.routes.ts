import { Router } from 'express';
import { mixedAuth } from '../../../shared/middlewares/mixedAuth';
import { ALL_ROLES, ADMIN_ROLES } from '../../identity/constants/roles.constants';
import { validateOrganizationQuery } from '../middlewares/validateOrganizationQuery.middleware';
import { validateCreateEquipment } from '../middlewares/validateEquipment.middleware';
import {
  createEquipmentController,
  getEquipmentLabelController,
  listLocationsController,
} from '../controllers/equipment.controller';
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
const READ_ROLES = ALL_ROLES;

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
router.get('/organization/locations', mixedAuth(READ_ROLES), listLocationsController);

/**
 * Écriture : le plan d'usine (où sont les frigos, les cuves) est une donnée de configuration.
 * Seuls les responsables la modifient — un opérateur terrain scanne, il ne déclare pas de
 * nouveaux matériels.
 */
const CONFIG_ROLES = ADMIN_ROLES;

router.post(
  '/organization/equipment',
  mixedAuth(CONFIG_ROLES),
  validateCreateEquipment,
  createEquipmentController
);

/** L'étiquette à imprimer et coller sur le matériel : c'est ce que l'opérateur scannera. */
router.get('/organization/equipment/:id/label', mixedAuth(READ_ROLES), getEquipmentLabelController);

export default router;
