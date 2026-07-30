import { Router } from 'express';
import { sessionAuth } from '../../../../shared/middlewares/sessionAuth';
import { ALL_ROLES, WRITE_ROLES } from '../../../identity/constants/roles.constants';
import {
  validateCreateLogisticUnit,
  validateMoveLogisticUnit,
  validateScanLogisticUnit,
} from '../middlewares/validateLogisticUnit.middleware';
import {
  createLogisticUnitController,
  moveLogisticUnitController,
  resolveLogisticUnitController,
} from '../controllers/logisticUnit.controller';

const router = Router();

/**
 * @swagger
 * /api/logistics/logistic-units:
 *   post:
 *     summary: Constitue une palette et lui attribue son SSCC
 *     description: >
 *       Le SSCC est attribué à la palettisation, pas au départ du camion : une palette existe
 *       avant d'être expédiée et survit à la réception. Émet un AggregationEvent EPCIS au bizStep
 *       `packing`. Ne déduit aucun stock — la déduction reste à l'expédition. Un lot en
 *       quarantaine ou sous rappel ne se palettise pas.
 *     tags: [Logistics - Palettes]
 *     security: [{ sessionAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             properties:
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 100
 *                 items:
 *                   type: object
 *                   required: [id_lot, quantite]
 *                   properties:
 *                     id_lot: { type: string, format: uuid }
 *                     quantite: { type: number, minimum: 0, exclusiveMinimum: true }
 *     responses:
 *       201: { description: "Palette constituée (id, sscc, nombre de lots)" }
 *       400: { description: "Payload invalide, quantité supérieure au stock, ou lot en double" }
 *       401: { description: "Aucune session" }
 *       403: { description: "Rôle insuffisant" }
 *       404: { description: "Lot introuvable dans l'organisation active" }
 *       409: { description: "Lot non palettisable (quarantaine, rappel, expédié)" }
 */
router.post(
  '/logistics/logistic-units',
  sessionAuth(WRITE_ROLES),
  validateCreateLogisticUnit,
  createLogisticUnitController
);

/**
 * @swagger
 * /api/logistics/logistic-units/by-sscc/{sscc}:
 *   get:
 *     summary: Contenu d'une palette à partir du SSCC scanné
 *     description: >
 *       Rend la palette et les lots qu'elle porte, avec leur état sanitaire.
 *       `contient_lot_rappele` signale un lot passé en rappel APRÈS la palettisation — c'est ce
 *       qui rend le rappel actionnable sur le quai. Authentifiée et cloisonnée par organisation :
 *       une palette expose des produits et des quantités.
 *     tags: [Logistics - Palettes]
 *     security: [{ sessionAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: sscc
 *         required: true
 *         description: 18 chiffres, ou 20 si la lecture a conservé le préfixe d'AI `00`.
 *         schema: { type: string }
 *     responses:
 *       200: { description: "Contenu de la palette" }
 *       400: { description: "Le code scanné n'a pas la forme d'un SSCC" }
 *       401: { description: "Aucune session" }
 *       404: { description: "Palette introuvable dans l'organisation active" }
 */
router.get(
  '/logistics/logistic-units/by-sscc/:sscc',
  sessionAuth(ALL_ROLES),
  validateScanLogisticUnit,
  resolveLogisticUnitController
);

/**
 * @swagger
 * /api/logistics/logistic-units/{id}/location:
 *   patch:
 *     summary: Ranger une palette — ses lots suivent
 *     description: >
 *       Un scan de la palette, un scan de l'emplacement, et la position de tous ses lots est mise à
 *       jour en une seule transaction. Ranger une palette n'est **pas obligatoire** : une palette
 *       peut n'avoir aucun emplacement, et un lot posé dessus reste déplaçable seul — il quitte
 *       alors la palette.
 *
 *       Tout ou rien : si un seul lot ne peut pas suivre (sous rappel, état changé entre-temps),
 *       rien ne bouge. Une demi-palette rangée serait un mensonge sur l'emplacement du reste.
 *
 *       La destination doit être un emplacement de stockage (`FRIGO`, `CONGELATEUR`, `ETAGERE`), pas
 *       un équipement de transformation. Un lot en quarantaine suit la palette : évacuer un frigo en
 *       panne est précisément le cas d'usage.
 *     tags: [Logistics - Palettes]
 *     security: [{ sessionAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
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
 *       200: { description: "Palette rangée (nombre de lots déplacés ; 0 si elle y était déjà)" }
 *       400: { description: "Payload invalide, ou destination qui n'est pas un emplacement de stockage" }
 *       401: { description: "Aucune session" }
 *       403: { description: "Rôle insuffisant" }
 *       404: { description: "Palette ou matériel introuvable dans l'organisation active" }
 *       409: { description: "Un lot de la palette est sous rappel, ou son état a changé pendant le geste" }
 */
router.patch(
  '/logistics/logistic-units/:id/location',
  sessionAuth(WRITE_ROLES),
  validateMoveLogisticUnit,
  moveLogisticUnitController
);

export default router;
