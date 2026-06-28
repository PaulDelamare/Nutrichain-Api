import { Router } from 'express';
import {
  createReceiptController,
  getReceiptStatsController,
  getReceiptByIdController,
  getBatchByIdController,
  getBatchLabelController,
  listReceiptsController,
  liftBatchQuarantineController,
} from '../controllers/receipt.controller';
import { validateReceiptParams } from '../middlewares/validateReceipt.middleware';
import { validateQuarantineLift } from '../middlewares/validateQuarantineLift.middleware';
import { mixedAuth } from '../../../../shared/middlewares/mixedAuth';
import { verifyReceiptAccess } from '../../middlewares/verifyReceiptAccess.middleware';
import { verifyBatchAccess } from '../../middlewares/verifyBatchAccess.middleware';
import { LOGISTICS_ROLES } from '../../constants/logistics.constants';

const router = Router();

// Rôles autorisés pour les lectures (Viewer+)
const LOGISTICS_READ_ROLES = [
  LOGISTICS_ROLES.VIEWER,
  LOGISTICS_ROLES.OPERATOR,
  LOGISTICS_ROLES.ADMIN,
  LOGISTICS_ROLES.OWNER,
];

// Rôles autorisés pour les écritures (Operator+)
const LOGISTICS_WRITE_ROLES = [
  LOGISTICS_ROLES.OPERATOR,
  LOGISTICS_ROLES.ADMIN,
  LOGISTICS_ROLES.OWNER,
];

router.post(
  '/logistics/receipts',
  mixedAuth(LOGISTICS_WRITE_ROLES),
  validateReceiptParams,
  createReceiptController
);

router.get(
  '/logistics/receipts/stats',
  mixedAuth([LOGISTICS_ROLES.ADMIN, LOGISTICS_ROLES.OWNER]),
  getReceiptStatsController
);

router.get('/logistics/receipts', mixedAuth(LOGISTICS_READ_ROLES), listReceiptsController);

router.get(
  '/logistics/receipts/:id',
  mixedAuth(LOGISTICS_READ_ROLES),
  verifyReceiptAccess,
  getReceiptByIdController
);

// Rôles Better Auth (front web) + rôles métier logistique
const BATCH_READ_ROLES = [
  'owner',
  'admin',
  'member',
  LOGISTICS_ROLES.VIEWER,
  LOGISTICS_ROLES.OPERATOR,
  LOGISTICS_ROLES.ADMIN,
  LOGISTICS_ROLES.OWNER,
];

router.get(
  '/logistics/batches/:id',
  mixedAuth(BATCH_READ_ROLES),
  verifyBatchAccess,
  getBatchByIdController
);

router.get(
  '/logistics/batches/:id/label',
  mixedAuth(BATCH_READ_ROLES),
  verifyBatchAccess,
  getBatchLabelController
);

// Levée de quarantaine : décision qualité réservée au rôle Qualité / Admin / Gérant
router.post(
  '/logistics/batches/:id/release',
  mixedAuth([LOGISTICS_ROLES.QA, LOGISTICS_ROLES.ADMIN, LOGISTICS_ROLES.OWNER]),
  verifyBatchAccess,
  validateQuarantineLift,
  liftBatchQuarantineController
);

export default router;
