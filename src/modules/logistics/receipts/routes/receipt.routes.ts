import { Router } from 'express';
import type { RequestHandler } from 'express';
import {
	createReceiptController,
	getReceiptStatsController,
	getReceiptByIdController,
	getBatchByIdController,
	getBatchLabelController,
	listReceiptsController,
} from '../controllers/receipt.controller';
import { validateReceiptParams } from '../middlewares/validateReceipt.middleware';
import { checkApiKey } from '../../../../shared/utils/checkApiKey/checkApiKey';
import { requireLogisticsRole } from '../../middlewares/requireLogisticsRole.middleware';
import { verifyReceiptAccess } from '../../middlewares/verifyReceiptAccess.middleware';
import { verifyBatchAccess } from '../../middlewares/verifyBatchAccess.middleware';

const router = Router();

// Sécurisation M2M du Quai
/**
 * 🔒 SÉCURITÉ LOGISTICS
 * 
 * DEUX FLUX DISTINCTS:
 * 1. B2B/M2M (checkApiKey) — Systèmes externes, IoT, WMS partenaires
 * 2. Web/Mobile (requireAuth + requireOrgRole) — Utilisateurs avec rôles
 * 
 * PROTECTION PAR ORGANISATION: Les utilisateurs Web ne voient que leur org active
 * STATS: Réservées à logistics_admin (pas accessible en B2B)
 */

// Helper pour mutualiser la protection Web héritée (temporaire avant migration complète vers requireLogisticsRole)
const requireWebLogistics = (roles: string[]): RequestHandler =>
  requireLogisticsRole(roles as ('owner' | 'admin' | 'member')[]);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FLUX B2B/M2M (Clé API) — Systèmes externes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * @openapi
 * /api/logistics/receipts:
 *   post:
 *     tags: [Logistics]
 *     summary: Enregistre une nouvelle réception de marchandise (M2M)
 *     security:
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [shipment_id, quantite_actuelle, unite_code, statut_controle, received_by]
 *             properties:
 *               shipment_id: { type: string, format: uuid }
 *               quantite_actuelle: { type: number }
 *               unite_code: { type: string, example: "KG" }
 *               statut_controle: { type: string, enum: [CONFORME, NON_CONFORME] }
 *               received_by: { type: string }
 *     responses:
 *       201:
 *         description: Réception créée avec succès et lot initialisé
 *       422:
 *         description: Erreur de validation (VineJS)
 *       401:
 *         description: Clé API invalide
 */
router.post(
	'/logistics/receipts',
	checkApiKey(),
	validateReceiptParams,
	createReceiptController,
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FLUX MIXTE (Web ou API Key) — Lecture unitaire
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * @openapi
 * /api/logistics/receipts/stats:
 *   get:
 *     tags: [Logistics]
 *     summary: Récupère les statistiques de réception du jour (Web Admin)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistiques récupérées
 *       403:
 *         description: Rôle insuffisant
 */
router.get(
	'/logistics/receipts/stats',
	requireWebLogistics(['admin', 'owner']),
	getReceiptStatsController,
);

/**
 * @openapi
 * /api/logistics/receipts/{id}:
 *   get:
 *     tags: [Logistics]
 *     summary: Récupère les détails d'une réception
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Détails de la réception
 *       403:
 *         description: Accès refusé (Multi-tenant isolation)
 */
router.get(
	'/logistics/receipts/:id',
	// Soit API Key, soit Session avec rôle
	(req, res, next) => {
		if (req.headers['x-api-key']) {
			return checkApiKey()(req, res, next);
		}
		return requireWebLogistics(['admin', 'owner', 'member'])(req, res, next);
	},
	verifyReceiptAccess,
	getReceiptByIdController,
);

/**
 * @openapi
 * /api/logistics/batches/{id}:
 *   get:
 *     tags: [Logistics]
 *     summary: Récupère les détails d'un lot
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Détails du lot
 */
router.get(
	'/logistics/batches/:id',
	(req, res, next) => {
		if (req.headers['x-api-key']) {
			return checkApiKey()(req, res, next);
		}
		return requireWebLogistics(['admin', 'owner', 'member'])(req, res, next);
	},
	verifyBatchAccess,
	getBatchByIdController,
);

/**
 * @openapi
 * /api/logistics/batches/{id}/label:
 *   get:
 *     tags: [Logistics]
 *     summary: Génère l'étiquette GS1 Digital Link (QR Code)
 *     description: Retourne un flux binaire image/png (Cache 1 an).
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Image de l'étiquette PNG
 *         content:
 *           image/png:
 *             schema: { type: string, format: binary }
 */
router.get(
	'/logistics/batches/:id/label',
	(req, res, next) => {
		if (req.headers['x-api-key']) {
			return checkApiKey()(req, res, next);
		}
		return requireWebLogistics(['admin', 'owner', 'member'])(req, res, next);
	},
	verifyBatchAccess,
	getBatchLabelController,
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FLUX WEB/MOBILE (Better-Auth + RBAC) — Utilisateurs authentifiés
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/logistics/receipts — Lister réceptions paginées (filtrées par org active)
router.get(
	'/logistics/receipts',
	requireWebLogistics(['admin', 'owner', 'member']),
	listReceiptsController,
);

export default router;