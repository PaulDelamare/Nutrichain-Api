import { Router } from 'express';
import { createTransformation } from '../controllers/transformation.controller';
import { getBatchGenealogy, triggerRecall } from '../controllers/recall.controller';
import { publicScanBatch } from '../controllers/publicScan.controller';
import { validateTransformationParams } from '../middlewares/validateTransformation.middleware';
import { requireAuth } from '../../../identity/middlewares/requireAuth.middleware';
import { requireOrgRole } from '../../../identity/middlewares/requireOrgRole.middleware';
import rateLimit from 'express-rate-limit';

const router = Router();

// --- ROUTES PUBLIQUES (B2C) ---

const publicScanLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limite chaque IP à 100 requêtes par fenêtre
  message: { error: 'Trop de tentatives de scan. Veuillez réessayer dans 15 minutes.' },
});

/**
 * @swagger
 * /api/public/scan/{id}:
 *   get:
 *     summary: "[B2C] Scanner un lot pour voir son origine"
 *     description: Route publique pour les consommateurs finaux.
 *     tags: [Public]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Informations de traçabilité
 */
router.get('/public/scan/:id', publicScanLimiter, publicScanBatch);

// --- ROUTES PROTEGEES ---

/**
 * @swagger
 * /api/traceability/transformations:
 *   post:
 *     summary: Enregistrer une transformation de lots (Production)
 *     description: Permet de consommer un ou plusieurs lots existants pour créer un nouveau lot (Produit fini/semi-fini).
 *     tags: [Traçabilité]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id_produit_fini, id_materiel, quantite_produite, unite_code, inputs]
 *             properties:
 *               id_produit_fini:
 *                 type: string
 *                 format: uuid
 *               id_materiel:
 *                 type: string
 *                 format: uuid
 *               quantite_produite:
 *                 type: number
 *               unite_code:
 *                 type: string
 *               inputs:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     id_lot_parent:
 *                       type: string
 *                     quantite_prelevee:
 *                       type: number
 *                     unite:
 *                       type: string
 *                     lot_parent_epuise:
 *                       type: boolean
 *     responses:
 *       201:
 *         description: Transformation enregistrée
 */
router.post(
  '/traceability/transformations',
  requireAuth,
  requireOrgRole(['owner', 'admin', 'member']),
  validateTransformationParams,
  createTransformation
);

/**
 * @swagger
 * /api/traceability/batches/{id}/genealogy:
 *   get:
 *     summary: Récupérer la généalogie d'un lot (amont + aval)
 *     description: >
 *       Renvoie les lots parents (upstream) et descendants (downstream) calculés via une CTE
 *       récursive. Vue lecture plafonnée (1000 lignes). Lecture seule, non destructive.
 *     tags: [Traçabilité]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Identifiant du lot
 *     responses:
 *       200:
 *         description: Généalogie récupérée
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
 *                   example: "Généalogie récupérée."
 *                 data:
 *                   type: object
 *                   properties:
 *                     batchId:
 *                       type: string
 *                       format: uuid
 *                     upstream:
 *                       type: array
 *                       items:
 *                         type: object
 *                     downstream:
 *                       type: array
 *                       items:
 *                         type: object
 *       401:
 *         description: Organisation non identifiée
 *       403:
 *         description: Rôle insuffisant
 */
router.get(
  '/traceability/batches/:id/genealogy',
  requireAuth,
  requireOrgRole(['owner', 'admin', 'member']),
  getBatchGenealogy
);

/**
 * @swagger
 * /api/traceability/batches/{id}/recall:
 *   post:
 *     summary: Déclencher un rappel produit à partir d'un lot
 *     description: >
 *       Action destructive : bloque le lot source et TOUS ses descendants de façon récursive
 *       (set-based, sans plafond) et identifie les expéditions clients impactées. Réservé aux
 *       rôles owner/admin.
 *     tags: [Traçabilité]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Identifiant du lot source du rappel
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Motif du rappel (obligatoire)
 *     responses:
 *       200:
 *         description: Rappel exécuté, lots impactés bloqués
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
 *                 data:
 *                   type: object
 *                   properties:
 *                     blockedBatchesCount:
 *                       type: integer
 *                     impactedBatchIds:
 *                       type: array
 *                       items:
 *                         type: string
 *                     affectedShipments:
 *                       type: array
 *                       items:
 *                         type: object
 *                     depthSaturated:
 *                       type: boolean
 *       400:
 *         description: Motif manquant
 *       401:
 *         description: Authentification requise
 *       403:
 *         description: Rôle insuffisant (owner/admin requis)
 */
router.post(
  '/traceability/batches/:id/recall',
  requireAuth,
  requireOrgRole(['owner', 'admin']),
  triggerRecall
);

export default router;
