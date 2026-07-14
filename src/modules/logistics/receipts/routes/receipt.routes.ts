import { Router } from 'express';
import {
  createReceiptController,
  getReceiptStatsController,
  getReceiptByIdController,
  getBatchByIdController,
  getBatchLabelController,
  listReceiptsController,
  liftBatchQuarantineController,
} from '../controllers/receipt.controller';
import { validateReceiptParams } from '../middlewares/validateReceipt.middleware';
import { validateQuarantineLift } from '../middlewares/validateQuarantineLift.middleware';
import { mixedAuth } from '../../../../shared/middlewares/mixedAuth';
import { verifyReceiptAccess } from '../../middlewares/verifyReceiptAccess.middleware';
import { verifyBatchAccess } from '../../middlewares/verifyBatchAccess.middleware';
import { LOGISTICS_ROLES } from '../../constants/logistics.constants';

const router = Router();

// Rôles autorisés pour les lectures (Viewer+)
const LOGISTICS_READ_ROLES = [
  LOGISTICS_ROLES.VIEWER,
  LOGISTICS_ROLES.OPERATOR,
  LOGISTICS_ROLES.ADMIN,
  LOGISTICS_ROLES.OWNER,
];

// Rôles autorisés pour les écritures (Operator+)
const LOGISTICS_WRITE_ROLES = [
  LOGISTICS_ROLES.OPERATOR,
  LOGISTICS_ROLES.ADMIN,
  LOGISTICS_ROLES.OWNER,
];

/**
 * @swagger
 * /api/logistics/receipts:
 *   post:
 *     summary: Créer une réception et générer le lot associé
 *     description: >
 *       Crée une `Receipt` et le `Batch` correspondant dans une transaction atomique.
 *       Accessible via session web (rôles logistiques en écriture) ou clé API (M2M).
 *     tags: [Logistique]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id_fournisseur, shipment_id, id_produit, quantite_actuelle, unite_code, statut_controle, received_by]
 *             properties:
 *               id_fournisseur:
 *                 type: string
 *                 format: uuid
 *               shipment_id:
 *                 type: string
 *                 description: Identifiant du lot de transport (3 à 100 caractères)
 *               id_produit:
 *                 type: string
 *                 format: uuid
 *               quantite_actuelle:
 *                 type: number
 *                 description: Quantité reçue (strictement positive)
 *               unite_code:
 *                 type: string
 *                 example: "KG"
 *               statut_controle:
 *                 type: string
 *                 enum: [OK, ALERTE, NONCONFORME, CONFORME]
 *               received_by:
 *                 type: string
 *                 format: uuid
 *                 description: Surchargé par l'utilisateur de session en mode web
 *     responses:
 *       201:
 *         description: Réception confirmée et lot généré
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: integer
 *                   example: 201
 *                 message:
 *                   type: string
 *                   example: "Réception confirmée et Lot généré"
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                     receiptId:
 *                       type: string
 *                       format: uuid
 *                     batchId:
 *                       type: string
 *                       format: uuid
 *       400:
 *         description: Payload invalide (champ manquant ou format incorrect)
 *       401:
 *         description: Non authentifié ou clé API manquante
 *       403:
 *         description: Rôle insuffisant
 *       404:
 *         description: Référence liée introuvable (fournisseur, produit, unité)
 */
router.post(
  '/logistics/receipts',
  mixedAuth(LOGISTICS_WRITE_ROLES),
  validateReceiptParams,
  createReceiptController
);

/**
 * @swagger
 * /api/logistics/receipts/stats:
 *   get:
 *     summary: Statistiques journalières des réceptions
 *     tags: [Logistique]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Statistiques du jour récupérées
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
 *                     total_receipts_today:
 *                       type: integer
 *                     total_quantity_kg:
 *                       type: number
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Rôle insuffisant (Admin/Owner requis)
 */
router.get(
  '/logistics/receipts/stats',
  mixedAuth([LOGISTICS_ROLES.ADMIN, LOGISTICS_ROLES.OWNER]),
  getReceiptStatsController
);

/**
 * @swagger
 * /api/logistics/receipts:
 *   get:
 *     summary: Lister les réceptions (paginé, filtrable)
 *     tags: [Logistique]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *       - in: query
 *         name: supplierId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Liste paginée des réceptions
 *       401:
 *         description: Non authentifié
 */
router.get('/logistics/receipts', mixedAuth(LOGISTICS_READ_ROLES), listReceiptsController);

/**
 * @swagger
 * /api/logistics/receipts/{id}:
 *   get:
 *     summary: Récupérer une réception par son identifiant
 *     tags: [Logistique]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Réception trouvée (avec fournisseur si peuplé)
 *       404:
 *         description: Réception introuvable dans l'organisation active
 */
router.get(
  '/logistics/receipts/:id',
  mixedAuth(LOGISTICS_READ_ROLES),
  verifyReceiptAccess,
  getReceiptByIdController
);

// Rôles Better Auth (front web) + rôles métier logistique
const BATCH_READ_ROLES = [
  'owner',
  'admin',
  'member',
  LOGISTICS_ROLES.VIEWER,
  LOGISTICS_ROLES.OPERATOR,
  LOGISTICS_ROLES.ADMIN,
  LOGISTICS_ROLES.OWNER,
];

/**
 * @swagger
 * /api/logistics/batches/{id}:
 *   get:
 *     summary: Récupérer le détail d'un lot
 *     description: Renvoie le lot avec ses relations (produit, unité, utilisateur, matériel/lieu, 10 derniers mouvements).
 *     tags: [Logistique]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Lot trouvé
 *       404:
 *         description: Lot introuvable dans l'organisation active
 */
router.get(
  '/logistics/batches/:id',
  mixedAuth(BATCH_READ_ROLES),
  verifyBatchAccess,
  getBatchByIdController
);

/**
 * @swagger
 * /api/logistics/batches/{id}/label:
 *   get:
 *     summary: Générer l'étiquette QR (GS1 Digital Link) d'un lot
 *     description: Renvoie une image PNG (et non du JSON). Nécessite un GTIN sur le produit.
 *     tags: [Logistique]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Image PNG du QR code
 *         content:
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Produit sans GTIN, étiquette impossible
 *       404:
 *         description: Lot introuvable dans l'organisation active
 */
router.get(
  '/logistics/batches/:id/label',
  mixedAuth(BATCH_READ_ROLES),
  verifyBatchAccess,
  getBatchLabelController
);

/**
 * @swagger
 * /api/logistics/batches/{id}/release:
 *   post:
 *     summary: Lever la quarantaine d'un lot
 *     description: Décision qualité réservée aux rôles Qualité / Admin / Gérant. Repasse le lot en EN_STOCK.
 *     tags: [Logistique]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [motif]
 *             properties:
 *               motif:
 *                 type: string
 *                 description: Justification de la levée (3 à 500 caractères)
 *     responses:
 *       200:
 *         description: Quarantaine levée, lot repassé en stock
 *       404:
 *         description: Lot introuvable
 *       409:
 *         description: Le lot n'est pas en quarantaine
 */
// Levée de quarantaine : décision qualité réservée au rôle Qualité / Admin / Gérant
router.post(
  '/logistics/batches/:id/release',
  mixedAuth([LOGISTICS_ROLES.QA, LOGISTICS_ROLES.ADMIN, LOGISTICS_ROLES.OWNER]),
  verifyBatchAccess,
  validateQuarantineLift,
  liftBatchQuarantineController
);

export default router;
