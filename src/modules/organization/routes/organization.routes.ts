import { Router } from 'express';
import { sessionAuth } from '../../../shared/middlewares/sessionAuth';
import { ALL_ROLES, ADMIN_ROLES, QUALITY_ROLES } from '../../identity/constants/roles.constants';
import { validateOrganizationQuery } from '../middlewares/validateOrganizationQuery.middleware';
import { validateCreateEquipment } from '../middlewares/validateEquipment.middleware';
import { validateCreateQualityControl } from '../middlewares/validateQualityControl.middleware';
import {
  createQualityControlController,
  listPendingQualityControlController,
} from '../controllers/qualityControl.controller';
import {
  createEquipmentController,
  getEquipmentLabelController,
  listLocationsController,
} from '../controllers/equipment.controller';
import {
  listAlertsController,
  listAuditLogsController,
  listCustomersController,
  listEquipmentController,
  listMembersController,
  listMovementsController,
  listQualityControlsController,
  listQuarantineBatchesController,
  listShipmentsController,
  listSuppliersController,
} from '../controllers/organization.controller';

const router = Router();

// Lectures seules, cloisonnées par organisation — SESSION OBLIGATOIRE.
// La clé API n'y donne plus accès : `/organization/members` expose l'annuaire nominatif des
// salariés (donnée personnelle), et cette clé est publique par construction.
const READ_ROLES = ALL_ROLES;

router.get('/organization/members', sessionAuth(READ_ROLES), listMembersController);
router.get('/organization/alerts', sessionAuth(READ_ROLES), listAlertsController);
router.get(
  '/organization/audit-logs',
  sessionAuth(READ_ROLES),
  validateOrganizationQuery,
  listAuditLogsController
);
router.get(
  '/organization/quality-controls',
  sessionAuth(READ_ROLES),
  listQualityControlsController
);
router.get(
  '/organization/quarantine-batches',
  sessionAuth(READ_ROLES),
  listQuarantineBatchesController
);
router.get('/organization/equipment', sessionAuth(READ_ROLES), listEquipmentController);
router.get(
  '/organization/movements',
  sessionAuth(READ_ROLES),
  validateOrganizationQuery,
  listMovementsController
);
router.get('/organization/suppliers', sessionAuth(READ_ROLES), listSuppliersController);
router.get('/organization/customers', sessionAuth(READ_ROLES), listCustomersController);
router.get('/organization/shipments', sessionAuth(READ_ROLES), listShipmentsController);
router.get('/organization/locations', sessionAuth(READ_ROLES), listLocationsController);

/**
 * Écriture : le plan d'usine (où sont les frigos, les cuves) est une donnée de configuration.
 * Seuls les responsables la modifient — un opérateur terrain scanne, il ne déclare pas de
 * nouveaux matériels.
 */
const CONFIG_ROLES = ADMIN_ROLES;

/**
 * Barrière qualité de sortie d'usine.
 *
 * Un produit fini sort de transformation en `EN_ATTENTE_QC` : il ne peut ni être transformé ni
 * expédié tant qu'un contrôle ne l'a pas libéré. C'est ici que le rôle `quality` agit — et
 * l'opérateur en est exclu (celui qui produit ne valide pas lui-même sa production).
 *
 * `sessionAuth` : une décision qualité engage une PERSONNE. Une clé API identifie une
 * application, elle n'autorise pas une action (cf. durcissement de la clé API).
 */
router.get(
  '/organization/pending-quality-control',
  sessionAuth(READ_ROLES),
  listPendingQualityControlController
);

router.post(
  '/organization/quality-controls',
  sessionAuth(QUALITY_ROLES),
  validateCreateQualityControl,
  createQualityControlController
);

router.post(
  '/organization/equipment',
  sessionAuth(CONFIG_ROLES),
  validateCreateEquipment,
  createEquipmentController
);

/** L'étiquette à imprimer et coller sur le matériel : c'est ce que l'opérateur scannera. */
router.get(
  '/organization/equipment/:id/label',
  sessionAuth(READ_ROLES),
  getEquipmentLabelController
);

export default router;
