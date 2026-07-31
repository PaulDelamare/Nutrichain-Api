import { Router } from 'express';
import { sessionAuth } from '../../../../shared/middlewares/sessionAuth';
import {
  validateConfirmDelivery,
  validateShipmentParams,
} from '../middlewares/validateShipment.middleware';
import {
  confirmDeliveryController,
  createShipmentController,
} from '../controllers/shipment.controller';
import { WRITE_ROLES } from '../../../identity/constants/roles.constants';

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
 *             required: [id_client, shipment_id, transporteur, destination_adresse]
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
 *               palettes:
 *                 type: array
 *                 maxItems: 50
 *                 description: >
 *                   SSCC des palettes chargees telles quelles, le geste du quai. Leur contenu
 *                   devient les lignes du bon, chaque liaison porte la palette, et la palette est
 *                   videe : c est le seul cas ou l origine de la marchandise est certaine. Le code
 *                   peut porter son AI 00, tel qu une camera le rend. Une palette ne part qu une fois.
 *                 items:
 *                   type: string
 *                   pattern: "^(00)?[0-9]{18}$"
 *               lots:
 *                 type: array
 *                 maxItems: 500
 *                 description: >
 *                   Lots charges en vrac. Facultatif si des palettes sont fournies, mais l un des
 *                   deux doit porter quelque chose. Borne : une expedition de dizaines de milliers
 *                   de lignes ouvrait une transaction geante.
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
 *         description: |
 *           Payload invalide, expédition sans lot ni palette, lot chargé deux fois, lot non
 *           expédiable, ou plus de 500 lignes une fois les palettes développées (c'est ce total,
 *           et non le nombre d'entrées du payload, qui décide de la taille de la transaction).
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant
 *       404:
 *         description: Client ou lot introuvable dans l'organisation active
 *       409:
 *         description: |
 *           Référence d'expédition déjà utilisée, client archivé, palette déjà partie sur une autre
 *           expédition, palette sans contenu, ou conflit de verrou optimiste sur un lot modifié
 *           entre-temps — dans ce dernier cas, rejouer la requête.
 */
router.post(
  '/logistics/shipments',
  sessionAuth(WRITE_ROLES),
  validateShipmentParams,
  createShipmentController
);

/**
 * @swagger
 * /api/logistics/shipments/{id}/delivered:
 *   post:
 *     summary: Constate l arrivee d une expedition
 *     description: >
 *       Sans ce geste, `statut_livraison` restait fige a `EN_ROUTE` depuis la creation : le rappel
 *       produit lit ce champ et affichait donc toute expedition comme en transit, y compris livree
 *       depuis des semaines. La date est optionnelle — une arrivee se constate souvent le lendemain,
 *       sur un bon papier — mais bornee : jamais avant le depart, jamais dans le futur. Idempotent :
 *       rejouer rend 200 avec la date retenue ; un AUTRE auteur laisse une trace d audit.
 *       N emet aucun evenement EPCIS : l evenement d arrivee appartient au destinataire.
 *     tags: [Logistics - Expeditions]
 *     security: [{ sessionAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               date_livraison: { type: string, format: date-time }
 *     responses:
 *       200: { description: "Livraison confirmee (ou deja confirmee : la date retenue est rendue)" }
 *       400: { description: "Identifiant invalide, ou date hors bornes" }
 *       401: { description: "Aucune session" }
 *       403: { description: "Role insuffisant" }
 *       404: { description: "Expedition introuvable dans l organisation active" }
 *       409: { description: "Etat inattendu, ou confirmation concurrente" }
 */
router.post(
  '/logistics/shipments/:id/delivered',
  sessionAuth(WRITE_ROLES),
  validateConfirmDelivery,
  confirmDeliveryController
);

export default router;
