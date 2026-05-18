import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { AuthenticatedRequest } from './requireLogisticsRole.middleware';

/**
 * Middleware: Vérifier l'Accès à une Réception (Filtre par Organisation)
 *
 * RESPONSABILITÉ:
 * - Vérifier qu'une réception existe
 * - Vérifier que l'utilisateur Web peut accéder à cette réception (multi-tenant)
 */
export const verifyReceiptAccess = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
	try {
		const receiptId = req.params.id as string;
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

		// ===== ÉTAPE 1: Récupérer la réception =====
		const receipt = await prisma.receipt.findFirst({
			where: { 
				id: receiptId,
				organization_id: activeOrgId 
			},
			include: {
				fournisseur: true
			},
		});

		// ===== ÉTAPE 2: Vérifier existence et isolation =====
		if (!receipt) {
			res.status(404).json({
				status: 404,
				error: [{ field: 'receipt', message: 'Réception introuvable dans votre organisation' }],
			});
			return;
		}

		// ✅ SUCCESS: Accès autorisé
		authReq.receipt = receipt;

		next();
	} catch (error) {
		console.error('[VerifyReceiptAccess Middleware Error]', error);
		res.status(500).json({
			status: 500,
			error: [{ field: 'server', message: 'Erreur serveur' }],
		});
	}
};

export default verifyReceiptAccess;
