import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { AuthenticatedRequest } from './requireLogisticsRole.middleware';

/**
 * Middleware: Vérifier l'Accès à un Lot (Batch) (Filtre par Organisation)
 *
 * RESPONSABILITÉ:
 * - Vérifier qu'un lot existe
 * - Vérifier que l'utilisateur Web peut accéder à ce lot (multi-tenant)
 * - Rejeter les tentatives de cross-organization access
 */
export const verifyBatchAccess = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
	try {
		const batchId = req.params.id as string;
		const authReq = req as AuthenticatedRequest;
		const activeOrgId = authReq.activeOrgId;

		const apiKey = req.header('x-api-key');
		if (apiKey) return next();

		if (!activeOrgId) {
			res.status(400).json({
				status: 400,
				error: [{ field: 'organization', message: 'Organisation active manquante' }],
			});
			return;
		}

		// ===== ÉTAPE 1: Récupérer le lot =====
		const batch = await prisma.batch.findFirst({
			where: { 
				id: batchId,
				organization_id: activeOrgId 
			},
			include: {
				product: true,
				unit: true
			},
		});

		// ===== ÉTAPE 2: Vérifier existence et isolation =====
		if (!batch) {
			res.status(404).json({
				status: 404,
				error: [{ field: 'batch', message: 'Lot introuvable dans votre organisation' }],
			});
			return;
		}

		// ✅ SUCCESS: Accès autorisé - Attacher le lot au contexte
		authReq.batch = batch;

		next();
	} catch (error) {
		console.error('[VerifyBatchAccess Middleware Error]', error);
		res.status(500).json({
			status: 500,
			error: [{ field: 'server', message: 'Erreur serveur' }],
		});
	}
};

export default verifyBatchAccess;
