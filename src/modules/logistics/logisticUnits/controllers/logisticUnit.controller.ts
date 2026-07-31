import { Response } from 'express';
import { logisticUnitService } from '../services/logisticUnit.service';
import { labelService } from '../../shared/services/label.service';
import { sendSuccess } from '../../../../shared/utils/returnSuccess/returnSuccess';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';
import { stripSsccAi } from '../../../../shared/utils/gs1/sscc';

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

export const moveLogisticUnitController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const equipmentId = req.validatedLogisticUnitMove?.id_materiel;
    if (!equipmentId) {
      throw new APIError(400, {
        error: [{ field: 'id_materiel', message: 'Emplacement de destination manquant.' }],
      });
    }

    const userId = req.auth?.user?.id;
    if (!userId) {
      throw new APIError(401, {
        error: [{ field: 'auth', message: 'Auteur du rangement non identifié.' }],
      });
    }

    const unit = await logisticUnitService.moveLogisticUnit(
      req.params.id as string,
      req.activeOrgId as string,
      userId,
      equipmentId
    );

    sendSuccess(res, 200, 'Palette rangée.', unit);
  }
);

export const openLogisticUnitController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const params = req.validatedLogisticUnitOpen;
    if (!params) {
      throw new APIError(500, {
        error: [{ field: 'id', message: 'Identifiant de palette non validé.' }],
      });
    }

    const userId = req.auth?.user?.id;
    if (!userId) {
      throw new APIError(401, {
        error: [{ field: 'auth', message: "Auteur de l'ouverture non identifié." }],
      });
    }

    const unit = await logisticUnitService.openLogisticUnit(
      params.id,
      req.activeOrgId as string,
      userId
    );

    sendSuccess(res, 200, 'Palette ouverte. Ses lots redeviennent autonomes.', unit);
  }
);

export const resolveLogisticUnitController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const scan = req.validatedLogisticUnitScan;
    if (!scan) {
      throw new APIError(500, { error: [{ field: 'sscc', message: 'SSCC non validé.' }] });
    }

    // La caméra rend l'element string complet : l'AI `00` en fait partie, l'identifiant non.
    const sscc = stripSsccAi(scan.sscc);

    const unit = await logisticUnitService.resolveBySscc(sscc, req.activeOrgId as string);

    sendSuccess(res, 200, 'Contenu de la palette.', unit);
  }
);

export const getLogisticUnitLabelController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const sscc = await logisticUnitService.getSsccById(id, req.activeOrgId as string);
    const elementString = labelService.generateSsccElementString(sscc);
    const qrBuffer = await labelService.generateQRCode(elementString);

    // `private` : la route est authentifiée et cloisonnée, et `public` autoriserait un cache
    // partagé à resservir le SSCC d'une organisation à un appelant sans session. Cinq minutes,
    // parce qu'imprimer est un geste ponctuel — même contrat que l'étiquette de lot.
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="label-pallet-${sscc}.png"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(qrBuffer);
  }
);
