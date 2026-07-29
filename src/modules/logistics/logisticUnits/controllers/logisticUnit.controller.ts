import { Response } from 'express';
import { logisticUnitService } from '../services/logisticUnit.service';
import { sendSuccess } from '../../../../shared/utils/returnSuccess/returnSuccess';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';

export const createLogisticUnitController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const payload = req.validatedLogisticUnit;
    if (!payload) {
      throw new APIError(500, {
        error: [{ field: 'items', message: 'Contenu de palette non validé.' }],
      });
    }

    // L'auteur vient de la session, et de NULLE PART ailleurs : ce qui n'existe pas dans le corps
    // ne se falsifie pas.
    const userId = req.auth?.user?.id;
    if (!userId) {
      throw new APIError(401, {
        error: [{ field: 'auth', message: 'Auteur de la palettisation non identifié.' }],
      });
    }

    const unit = await logisticUnitService.createLogisticUnit({
      organizationId: req.activeOrgId as string,
      userId,
      items: payload.items,
    });

    sendSuccess(res, 201, 'Palette constituée.', unit);
  }
);

export const resolveLogisticUnitController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const scan = req.validatedLogisticUnitScan;
    if (!scan) {
      throw new APIError(500, { error: [{ field: 'sscc', message: 'SSCC non validé.' }] });
    }

    // La caméra rend l'element string complet : l'AI `00` en fait partie, l'identifiant non.
    const sscc = scan.sscc.length === 20 ? scan.sscc.slice(2) : scan.sscc;

    const unit = await logisticUnitService.resolveBySscc(sscc, req.activeOrgId as string);

    sendSuccess(res, 200, 'Contenu de la palette.', unit);
  }
);
