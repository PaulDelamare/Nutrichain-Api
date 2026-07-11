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
import {
  ALL_ROLES,
  WRITE_ROLES,
  QUALITY_ROLES,
  ADMIN_ROLES,
} from '../../../identity/constants/roles.constants';

const router = Router();

router.post(
  '/logistics/receipts',
  mixedAuth(WRITE_ROLES),
  validateReceiptParams,
  createReceiptController
);

router.get('/logistics/receipts/stats', mixedAuth(ADMIN_ROLES), getReceiptStatsController);

router.get('/logistics/receipts', mixedAuth(ALL_ROLES), listReceiptsController);

router.get(
  '/logistics/receipts/:id',
  mixedAuth(ALL_ROLES),
  verifyReceiptAccess,
  getReceiptByIdController
);

router.get(
  '/logistics/batches/:id',
  mixedAuth(ALL_ROLES),
  verifyBatchAccess,
  getBatchByIdController
);

router.get(
  '/logistics/batches/:id/label',
  mixedAuth(ALL_ROLES),
  verifyBatchAccess,
  getBatchLabelController
);

// Levée de quarantaine : décision qualité réservée à Qualité / Admin / Owner
// (l'opérateur en est exclu — séparation des tâches HACCP).
router.post(
  '/logistics/batches/:id/release',
  mixedAuth(QUALITY_ROLES),
  verifyBatchAccess,
  validateQuarantineLift,
  liftBatchQuarantineController
);

export default router;
