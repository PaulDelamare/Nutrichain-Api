import { Request, Response, NextFunction } from 'express';
import { auth } from '../../identity/auth.config';
import { type LogisticsRole } from '../constants/logistics.constants';
import { Session, User } from 'better-auth';

/**
 * Interface étendue pour la requête Express incluant les données de session et d'organisation.
 */
export interface AuthenticatedRequest extends Request {
	user?: User;
	session?: Session;
	activeOrgId?: string;
	memberRole?: LogisticsRole;
	batch?: unknown;
	receipt?: unknown;
}

/**
 * Middleware: Vérifier le Rôle Logistics (Flux Web/Mobile)
 *
 * RESPONSABILITÉ:
 * - Vérifier que l'utilisateur est authentifié via Better-Auth
 * - Extraire le rôle de l'utilisateur dans l'organisation active
 * - Vérifier que le rôle fait partie de la liste autorisée
 * - Attacher user, session, activeOrgId pour les contrôleurs
 */
export const requireLogisticsRole = (allowedRoles: LogisticsRole[]) => {
	return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		try {
			// ===== ÉTAPE 1: Récupérer la session =====
			const sessionPayload = await auth.api.getSession({
				headers: new Headers(req.headers as Record<string, string>),
			});

			if (!sessionPayload?.session || !sessionPayload?.user) {
				res.status(401).json({
					status: 401,
					error: [{ field: 'auth', message: 'Authentification requise' }],
				});
				return;
			}

			// ===== ÉTAPE 2: Vérifier qu'une organisation active est définie =====
			const activeOrgId = sessionPayload.session.activeOrganizationId;
			if (!activeOrgId) {
				res.status(400).json({
					status: 400,
					error: [{ field: 'organization', message: 'Aucune organisation active sélectionnée' }],
				});
				return;
			}

			// ===== ÉTAPE 3: Récupérer les infos de l'utilisateur dans cette organisation =====
			const orgDetails = await auth.api.getFullOrganization({
				headers: new Headers(req.headers as Record<string, string>),
				query: { organizationId: activeOrgId },
			});

			if (!orgDetails) {
				res.status(403).json({
					status: 403,
					error: [{ field: 'auth', message: 'Accès refusé' }],
				});
				return;
			}

			// ===== ÉTAPE 4: Trouver le rôle de l'utilisateur dans cette org =====
			const memberRecord = orgDetails.members.find((m) => m.userId === sessionPayload.user.id);

			if (!memberRecord) {
				res.status(403).json({
					status: 403,
					error: [{ field: 'auth', message: 'Accès refusé' }],
				});
				return;
			}

			const userRole = memberRecord.role as LogisticsRole;

			// ===== ÉTAPE 5: Vérifier que le rôle est autorisé =====
			if (!allowedRoles.includes(userRole)) {
				res.status(403).json({
					status: 403,
					error: [{ field: 'permission', message: 'Permission insuffisante' }],
				});
				return;
			}

			// ✅ SUCCESS: Authentification et autorisation validées
			const authReq = req as AuthenticatedRequest;
			authReq.user = sessionPayload.user;
			authReq.session = sessionPayload.session;
			authReq.activeOrgId = activeOrgId;
			authReq.memberRole = userRole;

			next();
		} catch (error) {
			console.error('[RequireLogisticsRole Middleware Error]', error);
			res.status(500).json({
				status: 500,
				error: [{ field: 'server', message: 'Erreur serveur' }],
			});
		}
	};
};

export default requireLogisticsRole;
