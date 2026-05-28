import { Router } from 'express';
import { syncScansController } from '../controllers/syncScans.controller';
import { validateSyncScans } from '../middlewares/validateSyncScans.middleware';
import { mixedAuth } from '../../../shared/middlewares/mixedAuth';
import { SYNC_WRITE_ROLES } from '../constants/sync.constants';

const router = Router();

router.post('/sync/scans', mixedAuth(SYNC_WRITE_ROLES), validateSyncScans, syncScansController);

export default router;
