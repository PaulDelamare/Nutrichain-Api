// ! IMPORTS
import { router } from '../../../shared/configs/router.config';
import { HealthController } from '../health.controller';

// ! Liveness
router.get('/health', HealthController.health);

// ! Readiness
router.get('/health/ready', HealthController.readiness);

export default router;
