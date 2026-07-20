import { Router } from 'express';
import { createTransformation } from '../controllers/transformation.controller';
import { getBatchGenealogy, triggerRecall } from '../controllers/recall.controller';
import { publicScanBatch } from '../controllers/publicScan.controller';
import { validateTransformationParams } from '../middlewares/validateTransformation.middleware';
import { validateRecall } from '../middlewares/validateRecall.middleware';
import { requireAuth } from '../../../identity/middlewares/requireAuth.middleware';
import { ALL_ROLES, WRITE_ROLES, QUALITY_ROLES } from '../../../identity/constants/roles.constants';
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
  requireOrgRole(WRITE_ROLES),
  validateTransformationParams,
  createTransformation
);

/**
 * @swagger
 * /api/traceability/batches/{id}/genealogy:
 *   get:
 *     summary: Récupérer la généalogie d'un lot
 *     tags: [Traçabilité]
 */
router.get(
  '/traceability/batches/:id/genealogy',
  requireAuth,
  requireOrgRole(ALL_ROLES),
  getBatchGenealogy
);

/**
 * @swagger
 * /api/traceability/batches/{id}/recall:
 *   post:
 *     summary: Déclencher un rappel produit à partir d'un lot
 *     description: Bloque le lot et tous ses descendants récursivement.
 *     tags: [Traçabilité]
 */
router.post(
  '/traceability/batches/:id/recall',
  requireAuth,
  requireOrgRole(QUALITY_ROLES),
  validateRecall,
  triggerRecall
);

export default router;
