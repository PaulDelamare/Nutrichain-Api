import { Response, NextFunction } from 'express';
import vine from '@vinejs/vine';
import { validateData } from '../../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';

/**
 * Validation des données d'entrée pour une réception.
 * 
 * Appliqué AVANT le contrôleur (Fail Fast).
 * Les erreurs sont catchées par le errorHandler global via next(error).
 */
export const validateReceiptParams = catchAsync(async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const schema = vine.object({
    id_fournisseur: vine.string().uuid(),
    shipment_id: vine.string().minLength(3).maxLength(100),
    id_produit: vine.string().uuid(),
    quantite_actuelle: vine.number().positive(),
    unite_code: vine.string().maxLength(10),
    statut_controle: vine.enum(['OK', 'ALERTE', 'NONCONFORME', 'CONFORME']),
    received_by: vine.string().uuid(),
  });

  const validatedData = await validateData(schema, req.body);
  // On attache les données validées à la requête pour éviter de parser le body plus tard
  req.validatedReceipt = validatedData;

  next();
});

