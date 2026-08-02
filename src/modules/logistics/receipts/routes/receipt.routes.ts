import { Router } from 'express';
import {
  createReceiptController,
  getReceiptStatsController,
  getReceiptByIdController,
  getBatchByIdController,
  getBatchLabelController,
  listReceiptsController,
  liftBatchQuarantineController,
  liftQualityQuarantineController,
  moveBatchController,
  scrapBatchController,
  resolveBatchByLotNumberController,
} from '../controllers/receipt.controller';
import { validateReceiptParams } from '../middlewares/validateReceipt.middleware';
import { validateBatchResolve } from '../middlewares/validateBatchResolve.middleware';
import { validateReceiptQuery } from '../middlewares/validateReceiptQuery.middleware';
import { validateQuarantineLift } from '../middlewares/validateQuarantineLift.middleware';
import { validateMoveBatch } from '../middlewares/validateMoveBatch.middleware';
import { validateScrap } from '../middlewares/validateScrap.middleware';
import { sessionAuth } from '../../../../shared/middlewares/sessionAuth';
import { verifyReceiptAccess } from '../../middlewares/verifyReceiptAccess.middleware';
import { verifyBatchAccess } from '../../middlewares/verifyBatchAccess.middleware';
import {
  ALL_ROLES,
  WRITE_ROLES,
  QUALITY_ROLES,
  ADMIN_ROLES,
} from '../../../identity/constants/roles.constants';

const router = Router();

/**
 * @swagger
 * /api/logistics/receipts:
 *   post:
 *     summary: Enregistrer une réception fournisseur (crée le lot)
 *     description: |
 *       Crée la réception ET le lot correspondant dans une seule transaction, avec son mouvement
 *       de stock, son événement EPCIS (ObjectEvent, URN LGTIN) et son entrée d'audit WORM.
 *
 *       **`NONCONFORME` ET `ALERTE` font naître le lot en quarantaine** (`BLOQUE`) : il devient
 *       intransformable et inexpédiable jusqu'à une décision qualité tracée. Seul `OK` laisse le
 *       lot disponible. `ALERTE` n'est pas un simple avertissement.
 *
 *       L'auteur vient de la session — aucun champ d'auteur n'est accepté dans le corps.
 *     tags: [Logistique]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id_fournisseur, shipment_id, id_produit, quantite_actuelle, unite_code, statut_controle]
 *             properties:
 *               id_fournisseur:
 *                 type: string
 *                 format: uuid
 *               shipment_id:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 100
 *                 description: Référence du bon de livraison fournisseur
 *               id_produit:
 *                 type: string
 *                 format: uuid
 *               quantite_actuelle:
 *                 type: number
 *                 description: Quantité reçue (strictement positive)
 *               unite_code:
 *                 type: string
 *                 maxLength: 10
 *                 example: kg
 *               statut_controle:
 *                 type: string
 *                 enum: [OK, ALERTE, NONCONFORME]
 *                 description: ALERTE et NONCONFORME placent tous deux le lot en quarantaine (BLOQUE)
 *               id_materiel:
 *                 type: string
 *                 format: uuid
 *                 description: Emplacement de stockage du lot reçu (optionnel)
 *               lot_number:
 *                 type: string
 *                 maxLength: 20
 *                 pattern: '^[A-Za-z0-9._-]{1,20}$'
 *                 description: |
 *                   Numéro fournisseur (GS1 AI 10). Absent, le serveur en génère un.
 *                   Jeu de caractères restreint : le numéro est interpolé dans l'URL du QR Digital
 *                   Link et dans l'URN EPCIS, où un `/` ou un `#` casserait l'étiquette.
 *               date_peremption:
 *                 type: string
 *                 pattern: '^\d{4}-\d{2}-\d{2}$'
 *                 example: '2026-08-15'
 *                 description: |
 *                   DLC fournisseur (GS1 AI 17), au JOUR. Ancrée en fin de journée UTC — un lot au
 *                   15/08 est consommable jusqu'au 15/08 au soir. Un jour inexistant est refusé.
 *     responses:
 *       201:
 *         description: Réception créée, lot généré
 *       400:
 *         description: Payload invalide (messages en français, orientés champ)
 *       401:
 *         description: |
 *           Aucune session. Une clé `x-api-key` seule ne suffit PAS : elle identifie une
 *           application, elle n'autorise personne.
 *       403:
 *         description: Rôle insuffisant (écriture réservée à owner/admin/operator)
 */
router.post(
  '/logistics/receipts',
  // Aucune écriture sans utilisateur authentifié — pas même pour une machine.
  //
  // Une intégration ERP se connecte avec un COMPTE DE SERVICE (un utilisateur, avec ses propres
  // identifiants et le rôle `operator`). Une clé ne suffit pas : celle du mobile est compilée dans
  // le bundle, donc extractible. Qui la détenait pouvait déclarer n'importe quel membre comme
  // auteur — y compris le patron — et cette signature partait dans la chaîne d'audit WORM.
  // Un compte de service, lui, se révoque ; une clé livrée à dix mille téléphones, non.
  sessionAuth(WRITE_ROLES),
  validateReceiptParams,
  createReceiptController
);

router.get('/logistics/receipts/stats', sessionAuth(ADMIN_ROLES), getReceiptStatsController);

/**
 * @swagger
 * /api/logistics/receipts:
 *   get:
 *     summary: Lister les réceptions de l'organisation active
 *     tags: [Logistique]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100000
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 500
 *           default: 20
 *         description: Plafonné par la règle de volumétrie du projet
 *     responses:
 *       200:
 *         description: Liste paginée
 *       400:
 *         description: Paramètre hors bornes ou non entier
 *       401:
 *         description: Aucune session
 */
router.get(
  '/logistics/receipts',
  sessionAuth(ALL_ROLES),
  validateReceiptQuery,
  listReceiptsController
);

router.get(
  '/logistics/receipts/:id',
  sessionAuth(ALL_ROLES),
  verifyReceiptAccess,
  getReceiptByIdController
);

// ⚠️ AVANT `/logistics/batches/:id` : Express prend la première route qui matche, et `resolve`
// serait sinon capturé comme un identifiant de lot (→ 404 systématique).
router.get(
  '/logistics/batches/resolve',
  sessionAuth(ALL_ROLES),
  validateBatchResolve,
  resolveBatchByLotNumberController
);

router.get(
  '/logistics/batches/:id',
  sessionAuth(ALL_ROLES),
  verifyBatchAccess,
  getBatchByIdController
);

/**
 * @swagger
 * /api/logistics/batches/{id}/label:
 *   get:
 *     summary: Étiquette scannable d'un lot (GS1 Digital Link)
 *     description: |
 *       Renvoie un QR code encodant le GTIN du produit et le numéro de lot au format
 *       **GS1 Digital Link**, scannable par un lecteur du commerce comme par le consommateur.
 *
 *       Réponse `Cache-Control: private` : la ressource est authentifiée et cloisonnée par
 *       organisation, aucun cache partagé ne doit la conserver.
 *
 *       **Impression : 180 px de côté au minimum** (≈ 16 mm à 300 ppp). Le symbole fait 66 modules
 *       de côté ; en dessous, un module ne couvre plus assez de pixels et le décodage échoue dès
 *       que s'ajoutent un angle, du flou ou une compression — les conditions normales d'une photo
 *       prise en atelier.
 *     tags: [Logistique]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Image PNG du QR code (réponse BINAIRE, pas l'enveloppe JSON habituelle)
 *         content:
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Aucune session
 *       404:
 *         description: Lot introuvable dans l'organisation active (anti-énumération)
 */
router.get(
  '/logistics/batches/:id/label',
  sessionAuth(ALL_ROLES),
  verifyBatchAccess,
  getBatchLabelController
);

// Levée de quarantaine : décision qualité réservée à Qualité / Admin / Owner. Le rôle ne suffit
// pas — le service refuse en plus que le lot soit libéré par celui qui l'a enregistré
// (cf. `separationOfDuties`), sauf si l'organisation n'a aucun autre décideur habilité.
/**
 * @swagger
 * /api/logistics/batches/{id}/release:
 *   post:
 *     summary: Lever la quarantaine d'un lot (décision qualité)
 *     description: |
 *       Repasse un lot `BLOQUE` en `EN_STOCK`. Le motif est obligatoire et la décision est scellée
 *       dans le journal WORM.
 *
 *       **Séparation des tâches HACCP** : le rôle ne suffit pas. La libération est refusée si
 *       l'appelant est celui qui a enregistré le lot — on ne valide pas sa propre production. Si
 *       l'organisation ne compte aucun autre décideur habilité, la levée passe et l'audit porte la
 *       mention `AUTO_SIGNEE_AUCUN_AUTRE_DECIDEUR`.
 *
 *       Un lot sous rappel (`ALERTE`) n'est PAS levable par ce canal : la décision est irréversible.
 *     tags: [Logistique]
 *     security:
 *       - bearerAuth: []
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
 *                 minLength: 3
 *                 maxLength: 500
 *                 description: Justification tracée dans l'audit WORM
 *     responses:
 *       200:
 *         description: Quarantaine levée, lot remis en stock
 *       400:
 *         description: Motif manquant, trop court ou trop long
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant, ou libération de sa propre production
 *       404:
 *         description: Lot introuvable dans l'organisation active
 *       409:
 *         description: Le lot n'est pas en quarantaine
 */
router.post(
  '/logistics/batches/:id/release',
  sessionAuth(QUALITY_ROLES),
  verifyBatchAccess,
  validateQuarantineLift,
  liftBatchQuarantineController
);

/**
 * @swagger
 * /api/logistics/batches/{id}/quality-release:
 *   post:
 *     summary: Lever la quarantaine qualité d'un lot (contre-analyse conforme)
 *     description: |
 *       Rend un lot `BLOQUE` par un contrôle NON CONFORME à son statut d'AVANT le blocage — et non
 *       à `EN_STOCK` : un produit fini qui attendait son contrôle de sortie y retourne, plutôt que
 *       de devenir expédiable sans avoir franchi la barrière HACCP.
 *
 *       **Une contre-analyse CONFORME postérieure au dernier verdict non conforme est requise** :
 *       une non-conformité ne se lève pas par déclaration, mais parce qu'un second contrôle l'a
 *       démentie. Le motif accompagne cette preuve, il ne la remplace pas.
 *
 *       **Séparation des tâches** : elle porte sur le signataire de la non-conformité. Si
 *       l'organisation ne compte aucun autre décideur habilité, la levée passe et l'audit porte la
 *       mention `AUTO_SIGNEE_AUCUN_AUTRE_DECIDEUR`.
 *
 *       Un lot également retenu par une excursion de température non levée est refusé : le traiter
 *       ici le sortirait d'un frigo en panne.
 *     tags: [Logistique]
 *     security:
 *       - bearerAuth: []
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
 *                 minLength: 3
 *                 maxLength: 500
 *                 description: Justification tracée dans l'audit WORM
 *     responses:
 *       200:
 *         description: Quarantaine qualité levée, lot rendu à son statut d'avant blocage
 *       400:
 *         description: Motif manquant, trop court ou trop long
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant, ou levée par le signataire de la non-conformité
 *       404:
 *         description: Lot introuvable dans l'organisation active
 *       409:
 *         description: Lot hors quarantaine, contre-analyse manquante, ou isolation froid en vigueur
 */
router.post(
  '/logistics/batches/:id/quality-release',
  sessionAuth(QUALITY_ROLES),
  verifyBatchAccess,
  validateQuarantineLift,
  liftQualityQuarantineController
);

/**
 * @swagger
 * /api/logistics/batches/{id}/location:
 *   patch:
 *     summary: Déplace un lot vers un autre emplacement de stockage
 *     description: >
 *       Met à jour la position physique du lot (matériel). Sont déplaçables un lot disponible
 *       (EN_STOCK, EN_ATTENTE_QC) et un lot en quarantaine (BLOQUE) — évacuer un frigo en panne
 *       fait partie du geste, et le déplacement ne lève jamais la quarantaine. Un lot sous rappel
 *       (ALERTE) reste immobilisé. Le matériel cible doit être un emplacement de stockage
 *       (FRIGO, CONGELATEUR, ETAGERE). Réservé à owner/admin/operator : `quality` décide de la
 *       levée, pas de la manutention.
 *     tags: [Logistics - Batches]
 *     security: [{ sessionAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id_materiel]
 *             properties:
 *               id_materiel: { type: string, format: uuid }
 *     responses:
 *       200: { description: Lot déplacé (ou déjà à cet emplacement) }
 *       400: { description: Matériel manquant, ou pas un emplacement de stockage }
 *       401: { description: Aucune session }
 *       403: { description: Rôle insuffisant }
 *       404: { description: Lot ou matériel introuvable dans l'organisation active }
 *       409: { description: Lot non déplaçable (rappel, expédié, épuisé, rebut) ou état modifié }
 */
router.patch(
  '/logistics/batches/:id/location',
  sessionAuth(WRITE_ROLES),
  verifyBatchAccess,
  validateMoveBatch,
  moveBatchController
);

// Mise au rebut : décision qualité réservée à Qualité / Admin / Owner, au même titre que la
// levée de quarantaine — c'est l'issue d'un lot qu'aucune des deux autres ne peut plus libérer.
/**
 * @swagger
 * /api/logistics/batches/{id}/scrap:
 *   post:
 *     summary: Met un lot au rebut (destruction tracée)
 *     description: |
 *       Seule issue d'un lot sous rappel (`ALERTE`) ou en quarantaine (`BLOQUE`) qu'aucune décision
 *       qualité ne peut plus libérer. Remet la quantité à zéro et scelle le motif dans l'audit WORM :
 *       preuve de destruction opposable en cas de contrôle sanitaire.
 *     tags: [Logistique]
 *     security:
 *       - bearerAuth: []
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
 *                 minLength: 3
 *                 maxLength: 500
 *                 description: Justification tracée dans l'audit WORM
 *     responses:
 *       200:
 *         description: Lot mis au rebut
 *       400:
 *         description: Motif manquant, trop court ou trop long
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant
 *       404:
 *         description: Lot introuvable dans l'organisation active
 *       409:
 *         description: Le lot n'est ni en quarantaine ni sous rappel
 */
router.post(
  '/logistics/batches/:id/scrap',
  sessionAuth(QUALITY_ROLES),
  verifyBatchAccess,
  validateScrap,
  scrapBatchController
);

export default router;
