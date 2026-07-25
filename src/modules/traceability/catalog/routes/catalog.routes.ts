import { Router } from 'express';
import { getProducts, getBatches } from '../controllers/catalog.controller';
import { validateCatalogQuery } from '../middlewares/validateCatalogQuery.middleware';
import { requireAuth } from '../../../identity/middlewares/requireAuth.middleware';
import { requireOrgRole } from '../../../identity/middlewares/requireOrgRole.middleware';
import { CATALOG_READ_ROLES } from '../constants/catalog.constants';

const router = Router();

// ==========================================
// ROUTES LECTURE SEULE (Pour le frontend)
// ==========================================

// Accès autorisé uniquement via une session utilisateur valide (Frontend)
router.use('/traceability/products', requireAuth);
router.use('/traceability/batches', requireAuth);

/**
 * @swagger
 * /api/traceability/products:
 *   get:
 *     summary: Récupérer la liste des produits du catalogue
 *     tags: [Traçabilité]
 *     security:
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
router.get('/traceability/products', requireOrgRole(CATALOG_READ_ROLES), getProducts);

/**
 * @swagger
 * /api/traceability/batches:
 *   get:
 *     summary: Récupérer la liste paginée des lots (batches) en cours
 *     tags: [Traçabilité]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *           maxLength: 100
 *         description: >
 *           Recherche insensible à la casse sur le numéro de lot GS1, l'identifiant technique,
 *           le nom du produit, son GTIN et le statut.
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 500
 *           default: 100
 *     responses:
 *       200:
 *         description: Page de lots récupérée avec succès
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
 *                   example: "Lots récupérés avec succès"
 *                 data:
 *                   type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         type: object
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         page:
 *                           type: integer
 *                           example: 1
 *                         limit:
 *                           type: integer
 *                           example: 100
 *                         total:
 *                           type: integer
 *                           description: Nombre total de lots correspondants, toutes pages confondues
 *                           example: 342
 *                         totalPages:
 *                           type: integer
 *                           example: 4
 *       400:
 *         description: Paramètre de recherche ou de pagination invalide
 *       401:
 *         description: Non authentifié ou clé API manquante
 *       403:
 *         description: Accès refusé (rôle insuffisant ou organisation non sélectionnée)
 */
router.get(
  '/traceability/batches',
  requireOrgRole(CATALOG_READ_ROLES),
  validateCatalogQuery,
  getBatches
);

export default router;
