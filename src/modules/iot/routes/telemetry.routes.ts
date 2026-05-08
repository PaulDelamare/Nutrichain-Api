import { Router } from 'express';
import { ingestTelemetry, getSensorHistory } from '../controllers/telemetry.controller';

const router = Router();

// /api/telemetry
router.post('/telemetry/ping', ingestTelemetry);
router.get('/telemetry/:sensor_id/history', getSensorHistory);

export default router;
