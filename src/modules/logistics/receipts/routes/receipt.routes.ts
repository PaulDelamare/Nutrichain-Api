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
import { sessionAuth } from '../../../../shared/middlewares/sessionAuth';
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
  // Aucune écriture sans utilisateur authentifié — pas même pour une machine.
  //
  // Une intégration ERP se connecte avec un COMPTE DE SERVICE (un utilisateur, avec ses propres
  // identifiants et le rôle `operator`). Une clé ne suffit pas : celle du mobile est compilée dans
  // le bundle, donc extractible. Qui la détenait pouvait déclarer n'importe quel membre comme
  // auteur — y compris le patron — et cette signature partait dans la chaîne d'audit WORM.
  // Un compte de service, lui, se révoque ; une clé livrée à dix mille téléphones, non.
  sessionAuth(WRITE_ROLES),
  validateReceiptParams,
  createReceiptController
);

router.get('/logistics/receipts/stats', sessionAuth(ADMIN_ROLES), getReceiptStatsController);

router.get('/logistics/receipts', sessionAuth(ALL_ROLES), listReceiptsController);

router.get(
  '/logistics/receipts/:id',
  sessionAuth(ALL_ROLES),
  verifyReceiptAccess,
  getReceiptByIdController
);

router.get(
  '/logistics/batches/:id',
  sessionAuth(ALL_ROLES),
  verifyBatchAccess,
  getBatchByIdController
);

router.get(
  '/logistics/batches/:id/label',
  sessionAuth(ALL_ROLES),
  verifyBatchAccess,
  getBatchLabelController
);

// Levée de quarantaine : décision qualité réservée à Qualité / Admin / Owner
// (l'opérateur en est exclu — séparation des tâches HACCP).
router.post(
  '/logistics/batches/:id/release',
  sessionAuth(QUALITY_ROLES),
  verifyBatchAccess,
  validateQuarantineLift,
  liftBatchQuarantineController
);

export default router;
