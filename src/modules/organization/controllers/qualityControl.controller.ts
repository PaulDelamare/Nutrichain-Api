import { Response } from 'express';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { qualityControlService } from '../services/qualityControl.service';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { QualityResult } from '../../logistics/constants/logistics.constants';

export const createQualityControlController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const payload = req.validatedQualityControl!;

    // Une décision qualité engage une personne : elle exige une session humaine, jamais une clé API.
    const userId = req.auth?.user?.id;
    if (!userId) {
      throw new APIError(401, {
        error: [
          {
            field: 'user',
            message: 'Une session humaine est requise pour saisir un contrôle qualité.',
          },
        ],
      });
    }

    const result = await qualityControlService.createQualityControl({
      ...payload,
      resultat: payload.resultat as QualityResult,
      organization_id: req.activeOrgId as string,
      id_user_labo: userId,
    });

    sendSuccess(res, 201, 'Contrôle qualité enregistré', result);
  }
);

export const listPendingQualityControlController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const batches = await qualityControlService.listPendingQualityControl(
      req.activeOrgId as string
    );
    sendSuccess(res, 200, 'Lots en attente de contrôle qualité récupérés', batches);
  }
);
