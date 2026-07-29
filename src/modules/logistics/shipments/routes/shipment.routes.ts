import { Router } from 'express';
import { sessionAuth } from '../../../../shared/middlewares/sessionAuth';
import { validateShipmentParams } from '../middlewares/validateShipment.middleware';
import { createShipmentController } from '../controllers/shipment.controller';
import {
  getPalletLabelController,
  resolvePalletController,
} from '../controllers/palletLabel.controller';
import { validatePalletScan } from '../middlewares/validatePalletScan.middleware';
import { ALL_ROLES, WRITE_ROLES } from '../../../identity/constants/roles.constants';

const router = Router();

/**
 * Endpoints pour la gestion des Expéditions (Shipments)
 * Isolation Multi-Tenant via sessionAuth (session obligatoire, rôle évalué)
 */

// POST /api/logistics/shipments - Créer une expédition
/**
 * @swagger
 * /api/logistics/shipments:
 *   post:
 *     summary: Expédier des lots vers un client (agrégation SSCC)
 *     description: |
 *       Crée l'expédition, décrémente les lots, génère un **SSCC 18 chiffres** (unité logistique)
 *       et l'AggregationEvent EPCIS correspondant, le tout dans une seule transaction.
 *
 *       Un lot bloquant (`BLOQUE`, `EN_ATTENTE_QC`, `ALERTE`) ne peut pas être expédié : c'est la
 *       barrière sanitaire. `shipment_id: AUTO` fait générer la référence par le serveur.
 *     tags: [Logistique]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id_client, shipment_id, transporteur, destination_adresse, lots]
 *             properties:
 *               id_client:
 *                 type: string
 *                 format: uuid
 *               shipment_id:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 100
 *                 example: AUTO
 *               transporteur:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 100
 *               destination_adresse:
 *                 type: string
 *                 minLength: 5
 *                 maxLength: 255
 *               lots:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 500
 *                 description: Borné — une expédition de dizaines de milliers de lignes ouvrait une transaction géante
 *                 items:
 *                   type: object
 *                   required: [id_lot, quantite_expediee]
 *                   properties:
 *                     id_lot:
 *                       type: string
 *                       format: uuid
 *                     quantite_expediee:
 *                       type: number
 *                       description: Strictement positive
 *     responses:
 *       201:
 *         description: Expédition créée, SSCC généré
 *       400:
 *         description: Payload invalide, ou lot non expédiable (quarantaine, rappel, attente de contrôle)
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant
 *       404:
 *         description: Client ou lot introuvable dans l'organisation active
 *       409:
 *         description: |
 *           Référence d'expédition déjà utilisée, client archivé, ou conflit de verrou optimiste
 *           sur un lot modifié entre-temps — dans ce dernier cas, rejouer la requête.
 */
router.post(
  '/logistics/shipments',
  sessionAuth(WRITE_ROLES),
  validateShipmentParams,
  createShipmentController
);

/**
 * @swagger
 * /api/logistics/shipments/{id}/label:
 *   get:
 *     summary: Étiquette scannable d'une palette (SSCC)
 *     description: |
 *       QR code portant l'**element string GS1** `00` + SSCC — le format qu'attend un lecteur
 *       logistique, et non un Digital Link : une étiquette de palette s'adresse à la chaîne
 *       d'approvisionnement, pas au consommateur.
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
 *         description: Expédition introuvable dans l'organisation active (anti-énumération)
 */
router.get(
  '/logistics/shipments/:id/label',
  sessionAuth(ALL_ROLES),
  getPalletLabelController
);

/**
 * @swagger
 * /api/logistics/shipments/by-sscc/{sscc}:
 *   get:
 *     summary: Contenu d'une palette à partir du SSCC scanné
 *     description: |
 *       Rend l'expédition et les lots que la palette transporte, avec leur statut sanitaire —
 *       `contient_lot_rappele` signale un lot passé en rappel **après** son départ.
 *
 *       Authentifiée et cloisonnée : un SSCC expose le client, les produits et les quantités d'une
 *       livraison. Le canal public reste celui du lot (`/api/gs1/01/../10/..`).
 *     tags: [Logistique]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sscc
 *         required: true
 *         description: 18 chiffres, ou 20 si la lecture a conservé le préfixe d'AI `00`.
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Contenu de la palette
 *       400:
 *         description: Le code scanné n'a pas la forme d'un SSCC
 *       401:
 *         description: Aucune session
 *       404:
 *         description: Palette introuvable dans l'organisation active
 */
router.get(
  '/logistics/shipments/by-sscc/:sscc',
  sessionAuth(ALL_ROLES),
  validatePalletScan,
  resolvePalletController
);

export default router;
