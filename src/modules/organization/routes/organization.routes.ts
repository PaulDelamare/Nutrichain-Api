import { Router } from 'express';
import { sessionAuth } from '../../../shared/middlewares/sessionAuth';
import {
  ALL_ROLES,
  ADMIN_ROLES,
  QUALITY_ROLES,
  PERSONAL_DATA_ROLES,
} from '../../identity/constants/roles.constants';
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
import {
  createSupplierController,
  updateSupplierController,
  setSupplierActiveController,
  createLocationController,
  updateLocationController,
  setLocationActiveController,
} from '../controllers/referenceData.controller';
import {
  createCustomerController,
  updateCustomerController,
  setCustomerActiveController,
  createProductController,
  updateProductController,
  setProductActiveController,
} from '../controllers/customerProduct.controller';
import {
  validateCreateCustomer,
  validateUpdateCustomer,
  validateCreateProduct,
  validateUpdateProduct,
} from '../middlewares/customerProduct.schema';
import {
  changeMemberRoleController,
  revokeMemberController,
} from '../controllers/member.controller';
import { validateChangeMemberRole } from '../middlewares/member.schema';
import {
  validateCreateSupplier,
  validateUpdateSupplier,
  validateCreateLocation,
  validateUpdateLocation,
  validateSetActive,
} from '../middlewares/referenceData.schema';

const router = Router();

// Lectures seules, cloisonnées par organisation — session obligatoire.
//
// Deux niveaux, selon la nature de la donnée :
// - MÉTIER (catalogue, lots, alertes, équipement) → tous les rôles peuvent lire.
// - PERSONNELLE (annuaire du personnel, journal nominatif, coordonnées clients/fournisseurs,
//   nom de l'auteur des mouvements) → administration seule. Elles étaient ouvertes à tous, viewer
//   compris : un compte en lecture seule voyait l'e-mail et le statut MFA de chaque salarié.
const READ_ROLES = ALL_ROLES;

router.get('/organization/members', sessionAuth(PERSONAL_DATA_ROLES), listMembersController);
router.get('/organization/alerts', sessionAuth(READ_ROLES), listAlertsController);
router.get(
  '/organization/audit-logs',
  sessionAuth(PERSONAL_DATA_ROLES),
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
// Métier (l'opérateur en a besoin pour l'historique d'un lot), MAIS le nom de l'auteur des
// mouvements — seule donnée personnelle — est masqué pour les non-administrateurs, dans le service.
router.get(
  '/organization/movements',
  sessionAuth(READ_ROLES),
  validateOrganizationQuery,
  listMovementsController
);
// Fournisseurs et clients : lecture MÉTIER (tous les rôles) — l'opérateur en a besoin pour
// réceptionner et expédier. Le contrôleur restreint la projection aux non-administrateurs
// (identité métier seule) ; contact, e-mail et adresse du siège restent réservés à
// PERSONAL_DATA_ROLES, dans le service.
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

// Données de référence — fournisseurs et emplacements. Écritures réservées à l'administration
// (comme le matériel) : l'admin configure l'usine, l'opérateur reçoit. Archiver ≠ supprimer :
// ces objets sont référencés par des réceptions et du matériel (FK Restrict).
router.post(
  '/organization/suppliers',
  sessionAuth(CONFIG_ROLES),
  validateCreateSupplier,
  createSupplierController
);
router.patch(
  '/organization/suppliers/:id',
  sessionAuth(CONFIG_ROLES),
  validateUpdateSupplier,
  updateSupplierController
);
router.patch(
  '/organization/suppliers/:id/active',
  sessionAuth(CONFIG_ROLES),
  validateSetActive,
  setSupplierActiveController
);

router.post(
  '/organization/locations',
  sessionAuth(CONFIG_ROLES),
  validateCreateLocation,
  createLocationController
);
router.patch(
  '/organization/locations/:id',
  sessionAuth(CONFIG_ROLES),
  validateUpdateLocation,
  updateLocationController
);
router.patch(
  '/organization/locations/:id/active',
  sessionAuth(CONFIG_ROLES),
  validateSetActive,
  setLocationActiveController
);

// Clients et produits — mêmes règles : écritures réservées à l'administration, désactivation douce
// (référencés par des expéditions / lots — FK Restrict).
router.post(
  '/organization/customers',
  sessionAuth(CONFIG_ROLES),
  validateCreateCustomer,
  createCustomerController
);
router.patch(
  '/organization/customers/:id',
  sessionAuth(CONFIG_ROLES),
  validateUpdateCustomer,
  updateCustomerController
);
router.patch(
  '/organization/customers/:id/active',
  sessionAuth(CONFIG_ROLES),
  validateSetActive,
  setCustomerActiveController
);

router.post(
  '/organization/products',
  sessionAuth(CONFIG_ROLES),
  validateCreateProduct,
  createProductController
);
router.patch(
  '/organization/products/:id',
  sessionAuth(CONFIG_ROLES),
  validateUpdateProduct,
  updateProductController
);
router.patch(
  '/organization/products/:id/active',
  sessionAuth(CONFIG_ROLES),
  validateSetActive,
  setProductActiveController
);

// Gestion des membres — changer un rôle, révoquer un accès. Réservé aux administrateurs, journalisé.
// On ne cible jamais le propriétaire ni soi-même (cf. member.service). Pas de DELETE (le repo n'en
// utilise aucun) : la révocation est une action POST explicite.
router.patch(
  '/organization/members/:id/role',
  sessionAuth(CONFIG_ROLES),
  validateChangeMemberRole,
  changeMemberRoleController
);
router.post('/organization/members/:id/revoke', sessionAuth(CONFIG_ROLES), revokeMemberController);

export default router;
