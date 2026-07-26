import { Response } from 'express';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { observabilityService } from '../services/observability.service';

/**
 * Controller GET /api/observability/metrics.
 *
 * `Cache-Control: no-store` : les métriques changent à chaque requête servie, un cache
 * intermédiaire renverrait un instantané périmé sans le signaler.
 */
export const observabilityMetricsController = catchAsync(
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const activeOrgId = req.activeOrgId;
    if (!activeOrgId) {
      throw new APIError(400, {
        error: [{ field: 'organization', message: 'Organisation active manquante.' }],
      });
    }

    const metrics = await observabilityService.getDashboardMetrics({ organizationId: activeOrgId });

    res.setHeader('Cache-Control', 'no-store');
    sendSuccess(res, 200, 'Métriques calculées.', metrics);
  }
);

export default observabilityMetricsController;
