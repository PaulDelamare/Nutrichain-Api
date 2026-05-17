import { Router } from 'express';
import { getProducts, getBatches } from '../controllers/catalog.controller';
import { checkApiKey } from '../../../../shared/utils/checkApiKey/checkApiKey';
import { requireAuth } from '../../../identity/middlewares/requireAuth.middleware';
import { requireOrgRole } from '../../../identity/middlewares/requireOrgRole.middleware';

const router = Router();

// ==========================================
// SÉCURITÉ
// ==========================================
// Accès autorisé uniquement via l'API Key (B2B) ET une session utilisateur valide
router.use('/traceability/*', checkApiKey(), requireAuth);

// ==========================================
// ROUTES LECTURE SEULE (Pour le frontend)
// ==========================================

/**
 * @swagger
 * /api/traceability/products:
 *   get:
 *     summary: Récupérer la liste des produits du catalogue
 *     tags: [Traçabilité]
 *     security:
 *       - apiKeyAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des produits récupérée avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Produits récupérés avec succès"
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       nom:
 *                         type: string
 *                       code_gtin:
 *                         type: string
 *                       categorie:
 *                         type: string
 *                       duree_conservation_defaut:
 *                         type: integer
 *                       seuil_alerte_stock:
 *                         type: string
 *                       unite_reference:
 *                         type: string
 *       401:
 *         description: Non authentifié ou clé API manquante
 *       403:
 *         description: Accès refusé (rôle insuffisant ou organisation non sélectionnée)
 */
router.get('/traceability/products', requireOrgRole(['owner', 'admin', 'member']), getProducts);

/**
 * @swagger
 * /api/traceability/batches:
 *   get:
 *     summary: Récupérer la liste de tous les lots (batches) en cours
 *     tags: [Traçabilité]
 *     security:
 *       - apiKeyAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des lots récupérée avec succès
 *       401:
 *         description: Non authentifié ou clé API manquante
 *       403:
 *         description: Accès refusé (rôle insuffisant ou organisation non sélectionnée)
 */
router.get('/traceability/batches', requireOrgRole(['owner', 'admin', 'member']), getBatches);

export default router;
