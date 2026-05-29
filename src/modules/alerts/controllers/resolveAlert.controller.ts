import { Response } from 'express';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { alertService } from '../services/alert.service';

/**
 * Controller PATCH /api/alerts/:id/resolve.
 *
 * - `req.alert` est garanti présent par verifyAlertAccess (404 sinon).
 * - `req.auth.user.id` garanti par requireAuth + requireOrgRole.
 * - `req.validatedResolveAlert.note` validé/normalisé par validateResolveAlert.
 *
 * Le message de succès est contextualisé : si l'Alert est `PRODUCT_RECALL`, on warne
 * explicitement que la résolution ne ferme PAS le Recall (le Batch source reste `ALERTE`).
 * Cf. docs/17 § "Resolve Alert ≠ Close Recall".
 */
export const resolveAlertController = catchAsync(
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    // Garantis par requireAuth + verifyAlertAccess en amont (lever du `!` justifié).
    const userId = req.auth!.user.id;
    const alert = req.alert!;

    const note = req.validatedResolveAlert?.note;
    const result = await alertService.resolveAlert({ alert, userId, note });

    let message = result.alreadyResolved
      ? 'Alerte déjà résolue (idempotent).'
      : 'Alerte résolue avec succès.';

    if (result.alert.type === 'PRODUCT_RECALL') {
      message +=
        " Note : le rappel produit lui-même n'est pas clôturé par cette action — voir le workflow Recall.";
    }

    sendSuccess(res, 200, message, { alert: result.alert });
  }
);

export default resolveAlertController;
