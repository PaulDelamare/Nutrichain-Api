import { Response, NextFunction } from 'express';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';

/**
 * Middleware: Vérifier l'Accès à un Lot (Batch) (Filtre par Organisation)
 *
 * RESPONSABILITÉ:
 * - Vérifier qu'un lot existe
 * - Vérifier que l'utilisateur Web peut accéder à ce lot (multi-tenant)
 * - Rejeter les tentatives de cross-organization access
 */
export const verifyBatchAccess = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const batchId = req.params.id as string;
    const activeOrgId = req.activeOrgId;

    if (!activeOrgId) {
      throw new APIError(400, {
        error: [{ field: 'organization', message: 'Organisation active manquante.' }],
      });
    }

    // ===== ÉTAPE 1: Récupérer le lot =====
    const batch = await prisma.batch.findFirst({
      where: {
        id: batchId,
        organization_id: activeOrgId,
      },
      include: {
        product: true,
        unit: true,
      },
    });

    // ===== ÉTAPE 2: Vérifier existence et isolation =====
    if (!batch) {
      throw new APIError(404, {
        error: [{ field: 'batch', message: 'Lot introuvable dans votre organisation.' }],
      });
    }

    // ✅ SUCCESS: Accès autorisé - Attacher le lot au contexte
    req.batch = batch;

    next();
  }
);

export default verifyBatchAccess;
