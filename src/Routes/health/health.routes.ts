// ! IMPORTS
import { router } from '../../Configs/router.config';
import { HealthController } from '../../Controllers/health.controller';

// ! Liveness
router.get('/health', HealthController.health);

// ! Readiness
router.get('/health/ready', HealthController.readiness);

export default router;
