import { Response } from 'express';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';
import { sendSuccess } from '../../../../shared/utils/returnSuccess/returnSuccess';
import { genealogyService } from '../services/genealogy.service';
import { recallService } from '../services/recall.service';
import { AuthenticatedRequest } from '../../../identity/middlewares/requireAuth.middleware';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

/**
 * Récupère la généalogie complète d'un lot (Ascendance et Descendance).
 */
export const getBatchGenealogy = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const activeOrgId = req.activeOrgId || req.auth?.activeOrgId;
  const { id } = req.params;

  if (!activeOrgId) {
    throw new APIError(401, {
      error: [{ field: 'auth', message: 'Organisation non identifiée.' }],
    });
  }

  const [upstream, downstream, origines] = await Promise.all([
    genealogyService.getUpstream(id, activeOrgId),
    genealogyService.getDownstream(id, activeOrgId),
    genealogyService.getOrigins(id, activeOrgId),
  ]);

  return sendSuccess(res, 200, 'Généalogie récupérée.', {
    batchId: id,
    upstream,
    downstream,
    // Points d'entrée matière première (la « ferme » du cahier des charges) : sans ce champ, la
    // remontée amont s'arrêtait au lot de lait cru sans jamais nommer son fournisseur.
    origines,
  });
});

/**
 * Déclenche un rappel de produit (Blocage en cascade).
 */
export const triggerRecall = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const activeOrgId = req.activeOrgId || req.auth?.activeOrgId;
  const userId = req.auth?.user?.id;
  // `id` (UUID) et `reason` (chaîne bornée) sont validés en amont par validateRecall.
  const { id, reason } = req.validatedRecall!;

  if (!activeOrgId || !userId) {
    throw new APIError(401, {
      error: [{ field: 'auth', message: 'Authentification requise.' }],
    });
  }

  const result = await recallService.triggerRecall(id, activeOrgId, userId, reason);

  return sendSuccess(
    res,
    200,
    'Rappel produit exécuté avec succès. Tous les lots impactés sont bloqués.',
    result
  );
});
