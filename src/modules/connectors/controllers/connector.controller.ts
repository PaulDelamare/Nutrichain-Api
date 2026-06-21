import { Response } from 'express';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { productImportService } from '../services/productImport.service';
import { eventExportService } from '../services/eventExport.service';

/**
 * Connecteur ENTRANT : importe un catalogue produit depuis un CSV (ERP).
 * Le corps de la requête est le CSV brut (text/csv).
 */
export const importProductsController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const activeOrgId = req.activeOrgId as string;
    const csv = typeof req.body === 'string' ? req.body : '';

    if (!csv.trim()) {
      throw new APIError(400, {
        error: [{ field: 'body', message: 'Corps CSV vide ou Content-Type non text/csv.' }],
      });
    }

    const report = await productImportService.importProducts(activeOrgId, csv);
    return sendSuccess(res, 200, 'Import du catalogue produits traité.', report);
  }
);

/**
 * Connecteur SORTANT : exporte les événements de traçabilité EPCIS en CSV (ERP/WMS).
 */
export const exportEventsController = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const activeOrgId = req.activeOrgId as string;
    const csv = await eventExportService.exportEventsCsv(activeOrgId);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="epcis-events.csv"');
    return res.status(200).send(csv);
  }
);
