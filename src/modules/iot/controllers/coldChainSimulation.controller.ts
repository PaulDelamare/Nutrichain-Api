import { Response } from 'express';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { coldChainSimulationService } from '../services/coldChainSimulation.service';

/**
 * Déclenche une simulation d'incident chaîne du froid (démonstration). Ce n'est pas une réponse
 * cosmétique : le service injecte une vraie fenêtre d'excursion et rejoue le pipeline de détection,
 * créant l'alerte et la quarantaine identiques à un incident capteur réel.
 *
 * L'organisation vient de la SESSION (`req.activeOrgId`), jamais du corps : la simulation ne peut
 * frapper que l'organisation active de l'appelant.
 */
export const simulateColdChainIncident = catchAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const organizationId = req.activeOrgId;
    if (!organizationId) {
      throw new APIError(400, {
        error: [{ field: 'auth', message: 'Organisation active manquante.' }],
      });
    }

    const result = await coldChainSimulationService.simulateIncident({
      organizationId,
      equipmentId: req.validatedSimulateIncident?.equipmentId,
    });

    sendSuccess(res, 200, 'Incident chaîne du froid simulé.', result);
  }
);
