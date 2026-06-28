import { Response } from 'express';
import { syncScansService } from '../services/syncScans.service';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../identity/types/auth.types';

/**
 * POST /api/sync/scans
 *
 * Bulk sync mobile offline-first (Objectif SMART n°4). Réponse 207 Multi-Status :
 * chaque item est traité indépendamment et retourne son propre statut (ok / error / conflict).
 *
 * Le controller reste minimal : il extrait sessionUserId (session) et actorUserId (M2M)
 * et les transmet au service, qui décide de la résolution + des checks (membership + rôle).
 */
export const syncScansController = catchAsync(
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const validated = req.validatedSyncScans!;
    const organizationId = req.activeOrgId!;

    const result = await syncScansService.syncScans({
      items: validated.items,
      organizationId,
      sessionUserId: req.auth?.user?.id,
      actorUserId: validated.actorUserId,
    });

    sendSuccess(res, 207, 'Sync traité', result);
  }
);
