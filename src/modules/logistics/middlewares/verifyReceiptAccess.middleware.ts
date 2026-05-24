import { Response, NextFunction } from 'express';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';

/**
 * Middleware: Vérifier l'Accès à une Réception (Filtre par Organisation)
 *
 * RESPONSABILITÉ:
 * - Vérifier qu'une réception existe
 * - Vérifier que l'utilisateur Web peut accéder à cette réception (multi-tenant)
 */
export const verifyReceiptAccess = catchAsync(async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
	const receiptId = req.params.id as string;
	const activeOrgId = req.activeOrgId;

	const apiKey = req.header('x-api-key');
	if (apiKey) return next();

	if (!activeOrgId) {
		throw new APIError(400, {
			error: [{ field: 'organization', message: 'Organisation active manquante.' }],
		});
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
		throw new APIError(404, {
			error: [{ field: 'receipt', message: 'Réception introuvable dans votre organisation.' }],
		});
	}

	// ✅ SUCCESS: Accès autorisé
	req.receipt = receipt;

	next();
});

export default verifyReceiptAccess;
