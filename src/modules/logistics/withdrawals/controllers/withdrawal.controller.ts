import { Response } from 'express';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../../shared/utils/returnSuccess/returnSuccess';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';
import { withdrawalService } from '../services/withdrawal.service';

/** Enregistre le retrait d'un lot du rayon d'un magasin. */
export const recordWithdrawal = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const activeOrgId = req.activeOrgId || req.auth?.activeOrgId;
  const userId = req.auth?.user?.id;
  const { id, id_client, quantite, motif, constate_aupres_de } = req.validatedWithdrawal!;

  if (!activeOrgId || !userId) {
    throw new APIError(401, {
      error: [{ field: 'auth', message: 'Authentification requise.' }],
    });
  }

  const result = await withdrawalService.recordWithdrawal(id, activeOrgId, userId, {
    id_client,
    quantite,
    motif,
    constate_aupres_de,
  });

  return sendSuccess(res, 201, 'Retrait enregistré.', result);
});

/**
 * Avancement du retrait, par client.
 *
 * `Cache-Control: no-store` : le reste-à-retirer change à chaque déclaration, et un intermédiaire
 * qui le garderait ferait rouvrir un plafond déjà consommé.
 */
export const listWithdrawals = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const activeOrgId = req.activeOrgId || req.auth?.activeOrgId;
  const { id } = req.validatedWithdrawalList!;

  if (!activeOrgId) {
    throw new APIError(401, {
      error: [{ field: 'auth', message: 'Organisation non identifiée.' }],
    });
  }

  const clients = await withdrawalService.listWithdrawalsByCustomer(id, activeOrgId);

  res.setHeader('Cache-Control', 'no-store');
  return sendSuccess(res, 200, 'Avancement du retrait récupéré.', { batchId: id, clients });
});
