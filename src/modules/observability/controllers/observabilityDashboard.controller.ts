import { Response } from 'express';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { observabilityService } from '../services/observability.service';
import { renderDashboardHtml } from './renderDashboardHtml';

/** Controller GET /api/observability/dashboard — page HTML servie directement par l'API. */
export const observabilityDashboardController = catchAsync(
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const activeOrgId = req.activeOrgId;
    if (!activeOrgId) {
      throw new APIError(400, {
        error: [{ field: 'organization', message: 'Organisation active manquante.' }],
      });
    }

    const metrics = await observabilityService.getDashboardMetrics({ organizationId: activeOrgId });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).type('html').send(renderDashboardHtml(metrics));
  }
);

export default observabilityDashboardController;
