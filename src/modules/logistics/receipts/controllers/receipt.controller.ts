import { Response } from 'express';
import { receiptService } from '../services/receipt.service';
import { batchService } from '../../shared/services/batch.service';
import { labelService } from '../../shared/services/label.service';
import { sendSuccess } from '../../../../shared/utils/returnSuccess/returnSuccess';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { resolveWritingActor } from '../../../../shared/utils/auth/resolveWritingActor';
import { WRITE_ROLES } from '../../../identity/constants/roles.constants';

export const createReceiptController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const activeOrgId = req.activeOrgId as string;

    // Récupération des données validées par le middleware VineJS (garanties par la chaîne de routes)
    const validatedData = req.validatedReceipt;
    if (!validatedData) {
      throw new APIError(500, {
        error: [{ field: 'receipt', message: 'Données de réception non validées.' }],
      });
    }

    // L'auteur est scellé dans l'audit WORM : il ne peut pas être choisi par le client.
    // En M2M, l'acteur déclaré est VÉRIFIÉ membre de l'organisation (il ne l'était pas).
    const receivedBy = await resolveWritingActor({
      sessionUserId: req.auth?.user?.id,
      actorUserId: validatedData.actorUserId,
      organizationId: activeOrgId,
      allowedRoles: WRITE_ROLES,
    });

    const result = await receiptService.createReceipt({
      ...validatedData,
      received_by: receivedBy,
      organization_id: activeOrgId,
    });

    sendSuccess(res, 201, 'Réception confirmée et Lot généré', result);
  }
);

export const getReceiptStatsController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const activeOrgId = req.activeOrgId as string;
    const stats = await receiptService.getReceiptStats(activeOrgId);
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
 * Lève la quarantaine d'un lot (BLOQUE -> EN_STOCK) après décision qualité.
 */
export const liftBatchQuarantineController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const id = req.params.id as string;
    const activeOrgId = req.activeOrgId as string;
    // requireOrgRole injecte l'utilisateur dans req.auth.user (req.user est l'ancien canal déprécié)
    const userId = req.auth?.user?.id ?? req.user?.id;
    const motif = req.validatedQuarantineLift?.motif;

    if (!userId) {
      throw new APIError(401, {
        error: [{ field: 'user', message: 'Utilisateur requis pour lever une quarantaine.' }],
      });
    }
    if (!motif) {
      throw new APIError(400, {
        error: [{ field: 'motif', message: 'Motif de levée de quarantaine manquant.' }],
      });
    }

    const batch = await batchService.liftQuarantine(id, activeOrgId, userId, motif);
    sendSuccess(res, 200, 'Quarantaine levée, lot remis en stock', batch);
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
      throw new APIError(400, {
        error: [
          {
            field: 'batch',
            message: 'Ce lot ne possède pas de code GTIN valide pour la labellisation.',
          },
        ],
      });
    }

    const digitalLink = labelService.generateDigitalLink(gtin, batch.lot_number);

    // 3. Générer l'image QR
    const qrBuffer = await labelService.generateQRCode(digitalLink);

    // 4. Envoyer le flux image avec Cache-Control pour performance (Lot immuable)
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="label-batch-${id}.png"`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // Cache 1 an
    res.send(qrBuffer);
  }
);
