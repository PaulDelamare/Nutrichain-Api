import { Response } from 'express';
import { receiptService } from '../services/receipt.service';
import { labelService } from '../../shared/services/label.service';
import { sendSuccess } from '../../../../shared/utils/returnSuccess/returnSuccess';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../middlewares/requireLogisticsRole.middleware';

export const createReceiptController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const activeOrgId = req.activeOrgId as string;
    const result = await receiptService.createReceipt({
      ...req.body,
      organization_id: activeOrgId,
    });
    sendSuccess(res, 201, 'Réception confirmée', result);
  }
);

export const getReceiptStatsController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const activeOrgId = req.activeOrgId as string;
    // Charger dynamiquement le service pour éviter les problèmes d'import/mock lors des tests
    const module = await import('../services/receipt.service');
    const stats = await module.receiptService.getReceiptStats(activeOrgId);
    sendSuccess(res, 200, 'Statistiques récupérées', stats);
  }
);

export const getReceiptByIdController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const id = req.params.id as string;
    const activeOrgId = req.activeOrgId as string;
    const receipt = await receiptService.getReceiptById(id, activeOrgId);
    sendSuccess(res, 200, 'Réception récupérée', receipt);
  }
);

export const getBatchByIdController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const id = req.params.id as string;
    const activeOrgId = req.activeOrgId as string;
    const batch = await receiptService.getBatchById(id, activeOrgId);
    sendSuccess(res, 200, 'Lot récupéré', batch);
  }
);

export const listReceiptsController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const activeOrgId = req.activeOrgId as string;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

    const result = await receiptService.listReceipts(activeOrgId, page, limit);
    sendSuccess(res, 200, 'Réceptions récupérées', result);
  }
);

/**
 * Génère une étiquette QR Code pour un lot (GS1 Digital Link)
 */
export const getBatchLabelController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const id = req.params.id as string;
    const activeOrgId = req.activeOrgId as string;

    // 1. Récupérer les infos du lot (pour avoir le GTIN produit)
    const batch = await receiptService.getBatchById(id, activeOrgId);

    // 2. Générer le lien GS1
    const gtin = batch.produit?.code_gtin;

    if (!gtin) {
      throw {
        status: 400,
        error: [
          {
            field: 'batch',
            message: 'Ce lot ne possède pas de code GTIN valide pour la labellisation.',
          },
        ],
      };
    }

    const digitalLink = labelService.generateDigitalLink(gtin, batch.id);

    // 3. Générer l'image QR
    const qrBuffer = await labelService.generateQRCode(digitalLink);

    // 4. Envoyer le flux image avec Cache-Control pour performance (Lot immuable)
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="label-batch-${id}.png"`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // Cache 1 an
    res.send(qrBuffer);
  }
);
