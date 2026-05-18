import vine from '@vinejs/vine';
import { Request, Response, NextFunction } from 'express';
import { validateData } from '../../../../shared/utils/validateData/validateData';
import { handleError } from '../../../../shared/utils/errorHandler/errorHandler';

// Definition stricte de ce qu'on attend du scanner / quai de dechargement
const receiptSchema = vine.object({
  id_fournisseur: vine.string().uuid(),
  shipment_id: vine.string().trim().minLength(1),
  id_produit: vine.string().uuid(),
  quantite_actuelle: vine.number().positive(),
  unite_code: vine.string().trim(),
  statut_controle: vine.string().trim(),
  received_by: vine.string().uuid(),
});

export const validateReceiptParams = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await validateData(receiptSchema, req.body);
    next();
  } catch (error) {
    handleError(error, req, res, 'Validation Reception (Logistics/Receipt)');
  }
};
