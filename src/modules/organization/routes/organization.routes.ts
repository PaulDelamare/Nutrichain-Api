import { Router } from 'express';
import { checkApiKey } from '../../../shared/utils/checkApiKey/checkApiKey';
import { requireAuth } from '../../identity/middlewares/requireAuth.middleware';
import { requireOrgRole } from '../../identity/middlewares/requireOrgRole.middleware';
import {
  getMembers,
  getAlerts,
  getAuditLogs,
  getQualityControls,
  getQuarantineBatches,
  getEquipment,
  getMovements,
  getSuppliers,
  getCustomers,
  getShipments,
} from '../controllers/organization.controller';

const router = Router();
const readRoles = ['owner', 'admin', 'member'] as const;

router.use('/organization/*', checkApiKey(), requireAuth);

router.get('/organization/members', requireOrgRole([...readRoles]), getMembers);
router.get('/organization/alerts', requireOrgRole([...readRoles]), getAlerts);
router.get('/organization/audit-logs', requireOrgRole([...readRoles]), getAuditLogs);
router.get('/organization/quality-controls', requireOrgRole([...readRoles]), getQualityControls);
router.get(
  '/organization/quarantine-batches',
  requireOrgRole([...readRoles]),
  getQuarantineBatches
);
router.get('/organization/equipment', requireOrgRole([...readRoles]), getEquipment);
router.get('/organization/movements', requireOrgRole([...readRoles]), getMovements);
router.get('/organization/suppliers', requireOrgRole([...readRoles]), getSuppliers);
router.get('/organization/customers', requireOrgRole([...readRoles]), getCustomers);
router.get('/organization/shipments', requireOrgRole([...readRoles]), getShipments);

export default router;
