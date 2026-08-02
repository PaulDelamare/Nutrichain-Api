import { Router } from 'express';
import { sessionAuth } from '../../../shared/middlewares/sessionAuth';
import {
  ALL_ROLES,
  ADMIN_ROLES,
  OWNER_ONLY_ROLES,
  QUALITY_ROLES,
  PERSONAL_DATA_ROLES,
} from '../../identity/constants/roles.constants';
import { validateOrganizationQuery } from '../middlewares/validateOrganizationQuery.middleware';
import { validateShipmentQuery } from '../middlewares/validateShipmentQuery.middleware';
import { validateMemberQuery } from '../middlewares/validateMemberQuery.middleware';
import { validateRecallQuery } from '../middlewares/validateRecallQuery.middleware';
import { validateAuditLogQuery } from '../middlewares/validateAuditLogQuery.middleware';
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
  listRecallsController,
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
  transferOwnershipController,
  revokeMemberController,
} from '../controllers/member.controller';
import { validateChangeMemberRole } from '../middlewares/member.schema';
import { validateCreateIotGateway } from '../middlewares/iotGateway.schema';
import {
  createIotGatewayController,
  listIotGatewaysController,
  revokeIotGatewayController,
} from '../controllers/iotGateway.controller';
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

/**
 * @swagger
 * /api/organization/members:
 *   get:
 *     summary: Lister les membres de l'organisation active (annuaire nominatif)
 *     description: |
 *       Renvoie chaque membre avec l'identité de son compte : e-mail, nom et statut MFA
 *       (`twoFactorEnabled`).
 *
 *       **Donnée personnelle** : réservée à l'administration (owner/admin). Un rôle en lecture
 *       seule ne doit pas pouvoir énumérer l'e-mail et le statut MFA de chaque salarié.
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des membres
 *       401:
 *         description: Aucune session (une clé API seule ne l'autorise pas)
 *       403:
 *         description: Rôle insuffisant (réservé à owner/admin)
 */
router.get(
  '/organization/members',
  sessionAuth(PERSONAL_DATA_ROLES),
  validateMemberQuery,
  listMembersController
);

/**
 * @swagger
 * /api/organization/alerts:
 *   get:
 *     summary: Lister les alertes de l'organisation active
 *     description: Alertes (chaîne du froid, rappels) triées de la plus récente à la plus ancienne.
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des alertes
 *       401:
 *         description: Aucune session
 */
router.get('/organization/alerts', sessionAuth(READ_ROLES), listAlertsController);

/**
 * @swagger
 * /api/organization/recalls:
 *   get:
 *     summary: Lister les rappels produits (alertes de la famille RAPPEL), paginés et filtrés
 *     description: |
 *       Façade de lecture dédiée à la page Rappels : ne renvoie que les alertes de rappel
 *       (`PRODUCT_RECALL`, `RECALL_DEPTH_SATURATION`, `RAPPEL`), filtrables par statut
 *       (`en_cours`/`cloture`) et par recherche libre sur le message, du plus récent au plus ancien.
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Rappels paginés
 *       401:
 *         description: Aucune session
 */
router.get(
  '/organization/recalls',
  sessionAuth(READ_ROLES),
  validateRecallQuery,
  listRecallsController
);

/**
 * @swagger
 * /api/organization/audit-logs:
 *   get:
 *     summary: Consulter le journal d'audit WORM de l'organisation
 *     description: |
 *       Journal « qui a fait quoi », trié du plus récent au plus ancien.
 *
 *       **Donnée personnelle** (le journal est nominatif) : réservé à l'administration.
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 500
 *           default: 30
 *         description: Nombre d'entrées renvoyées. À défaut, 30.
 *     responses:
 *       200:
 *         description: Journal d'audit
 *       400:
 *         description: Paramètre `limit` hors bornes ou non entier
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant (réservé à owner/admin)
 */
router.get(
  '/organization/audit-logs',
  sessionAuth(PERSONAL_DATA_ROLES),
  validateAuditLogQuery,
  listAuditLogsController
);

/**
 * @swagger
 * /api/organization/quality-controls:
 *   get:
 *     summary: Lister les contrôles qualité de l'organisation
 *     description: Contrôles enregistrés, triés du plus récent au plus ancien, avec le lot associé.
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des contrôles qualité
 *       401:
 *         description: Aucune session
 */
router.get(
  '/organization/quality-controls',
  sessionAuth(READ_ROLES),
  listQualityControlsController
);

/**
 * @swagger
 * /api/organization/quarantine-batches:
 *   get:
 *     summary: Lister les lots en quarantaine (BLOQUE)
 *     description: Lots au statut `BLOQUE`, en attente d'une décision qualité de levée.
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des lots en quarantaine
 *       401:
 *         description: Aucune session
 */
router.get(
  '/organization/quarantine-batches',
  sessionAuth(READ_ROLES),
  listQuarantineBatchesController
);

/**
 * @swagger
 * /api/organization/equipment:
 *   get:
 *     summary: Lister le matériel de l'organisation (plan d'usine)
 *     description: Matériel (frigos, cuves, étagères…) avec le lieu où il est installé.
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste du matériel
 *       401:
 *         description: Aucune session
 */
router.get('/organization/equipment', sessionAuth(READ_ROLES), listEquipmentController);

// Métier (l'opérateur en a besoin pour l'historique d'un lot), MAIS le nom de l'auteur des
// mouvements — seule donnée personnelle — est masqué pour les non-administrateurs, dans le service.
/**
 * @swagger
 * /api/organization/movements:
 *   get:
 *     summary: Lister les mouvements de stock des lots
 *     description: |
 *       Historique des mouvements (réception, contrôle, transformation, expédition, quarantaine…),
 *       du plus récent au plus ancien.
 *
 *       **Le nom de l'auteur de chaque mouvement (donnée personnelle) n'est renvoyé qu'à
 *       l'administration.** Un opérateur voit tout l'historique métier du lot, sans savoir QUI a
 *       fait chaque geste.
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 500
 *         description: Nombre maximum de mouvements renvoyés
 *       - in: query
 *         name: lotId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Restreint l'historique à un lot précis (fiche lot du front)
 *     responses:
 *       200:
 *         description: Liste des mouvements
 *       400:
 *         description: Paramètre de requête invalide (`limit` hors bornes, `lotId` non UUID)
 *       401:
 *         description: Aucune session
 */
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
/**
 * @swagger
 * /api/organization/suppliers:
 *   get:
 *     summary: Lister les fournisseurs de l'organisation
 *     description: |
 *       Liste des fournisseurs actifs. L'opérateur ne reçoit que l'identité métier
 *       (`id`, `nom_ferme`) ; le contact et l'adresse du siège (données personnelles) sont
 *       réservés à l'administration.
 *
 *       `?includeArchived=true` n'est honoré que pour l'administration ; ignoré sinon.
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: includeArchived
 *         schema:
 *           type: boolean
 *         description: Inclure les fournisseurs archivés (administration uniquement)
 *     responses:
 *       200:
 *         description: Liste des fournisseurs
 *       401:
 *         description: Aucune session
 */
router.get('/organization/suppliers', sessionAuth(READ_ROLES), listSuppliersController);

/**
 * @swagger
 * /api/organization/customers:
 *   get:
 *     summary: Lister les clients de l'organisation
 *     description: |
 *       Liste des clients actifs. L'opérateur reçoit `id`, `nom_enseigne` et `adresse_livraison`
 *       (donnée d'exploitation) ; contact d'urgence, e-mail et notes (données personnelles) sont
 *       réservés à l'administration.
 *
 *       `?includeArchived=true` n'est honoré que pour l'administration ; ignoré sinon.
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: includeArchived
 *         schema:
 *           type: boolean
 *         description: Inclure les clients archivés (administration uniquement)
 *     responses:
 *       200:
 *         description: Liste des clients
 *       401:
 *         description: Aucune session
 */
router.get('/organization/customers', sessionAuth(READ_ROLES), listCustomersController);

/**
 * @swagger
 * /api/organization/shipments:
 *   get:
 *     summary: Lister les expéditions de l'organisation
 *     description: Expéditions triées par date d'envoi décroissante, avec client et lots liés.
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des expéditions
 *       401:
 *         description: Aucune session
 */
router.get(
  '/organization/shipments',
  sessionAuth(READ_ROLES),
  validateShipmentQuery,
  listShipmentsController
);

/**
 * @swagger
 * /api/organization/locations:
 *   get:
 *     summary: Lister les emplacements (lieux) de l'organisation
 *     description: |
 *       Lieux du plan d'usine, triés par nom. Actifs seulement par défaut.
 *
 *       `?includeArchived=true` n'est honoré que pour l'administration ; ignoré sinon.
 *
 *       `latitude`/`longitude` valent `null` tant que la position du lieu n'a pas été saisie.
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: includeArchived
 *         schema:
 *           type: boolean
 *         description: Inclure les emplacements archivés (administration uniquement)
 *     responses:
 *       200:
 *         description: Liste des emplacements
 *       401:
 *         description: Aucune session
 */
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
/**
 * @swagger
 * /api/organization/pending-quality-control:
 *   get:
 *     summary: Lister les lots en attente de contrôle qualité de sortie
 *     description: |
 *       Lots au statut `EN_ATTENTE_QC` : produits finis qui ne peuvent être ni transformés ni
 *       expédiés tant qu'un contrôle ne les a pas libérés. Sans cette liste, ils sont invisibles.
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lots en attente de contrôle qualité
 *       401:
 *         description: Aucune session
 */
router.get(
  '/organization/pending-quality-control',
  sessionAuth(READ_ROLES),
  listPendingQualityControlController
);

/**
 * @swagger
 * /api/organization/quality-controls:
 *   post:
 *     summary: Enregistrer un contrôle qualité (pilote le statut du lot)
 *     description: |
 *       Saisit un contrôle et applique atomiquement sa conséquence sur le lot. Le contrôle et le
 *       statut du lot ne peuvent pas diverger.
 *
 *       - `CONFORME` sur un lot `EN_ATTENTE_QC` le libère en `EN_STOCK`.
 *       - `NON_CONFORME` place le lot en quarantaine (`BLOQUE`).
 *       - Un lot sous rappel (`ALERTE`) est irréversible : aucun contrôle ne le libère (409).
 *       - La levée d'une quarantaine (`BLOQUE`) ne passe PAS par ce canal (409) : c'est une
 *         décision qualité tracée à part, avec motif.
 *
 *       **Séparation des tâches HACCP** : libérer son propre lot est tracé
 *       (`AUTO_SIGNEE_...`) si l'organisation n'a aucun autre décideur habilité.
 *
 *       L'auteur (`id_user_labo`) vient de la session — jamais du corps.
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id_lot, type_test, resultat]
 *             properties:
 *               id_lot:
 *                 type: string
 *                 format: uuid
 *               type_test:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 120
 *               resultat:
 *                 type: string
 *                 enum: [CONFORME, NON_CONFORME]
 *               notes:
 *                 type: string
 *                 maxLength: 1000
 *               certificat_pdf:
 *                 type: string
 *                 maxLength: 500
 *     responses:
 *       201:
 *         description: Contrôle enregistré
 *       400:
 *         description: Payload invalide (messages en français, orientés champ)
 *       401:
 *         description: Aucune session (une clé API seule ne l'autorise pas)
 *       403:
 *         description: Rôle insuffisant (réservé à owner/admin/quality)
 *       404:
 *         description: Lot introuvable dans l'organisation active
 *       409:
 *         description: |
 *           Transition interdite : lot sous rappel, lot en quarantaine (levée à part), ou statut du
 *           lot modifié pendant la saisie (verrou optimiste).
 */
router.post(
  '/organization/quality-controls',
  sessionAuth(QUALITY_ROLES),
  validateCreateQualityControl,
  createQualityControlController
);

/**
 * @swagger
 * /api/organization/equipment:
 *   post:
 *     summary: Créer un matériel (frigo, cuve, étagère…)
 *     description: |
 *       Rattache un matériel à un lieu de l'organisation et lui génère une étiquette scannable.
 *       Le type pilote la surveillance IoT (un frigo a un seuil de température, pas une étagère).
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nom, type, id_lieu]
 *             properties:
 *               nom:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 100
 *               type:
 *                 type: string
 *                 enum: [FRIGO, CONGELATEUR, CUVE, ETAGERE, MIXEUR]
 *               id_lieu:
 *                 type: string
 *                 format: uuid
 *                 description: Lieu d'installation (doit appartenir à l'organisation et être actif)
 *               temp_seuil_max:
 *                 type: number
 *                 description: Seuil de température au-delà duquel une excursion est détectée
 *               sensor_id:
 *                 type: string
 *                 maxLength: 100
 *     responses:
 *       201:
 *         description: Matériel créé
 *       400:
 *         description: Payload invalide, ou lieu introuvable dans l'organisation active
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant (réservé à owner/admin)
 *       409:
 *         description: L'emplacement visé est archivé
 */
router.post(
  '/organization/equipment',
  sessionAuth(CONFIG_ROLES),
  validateCreateEquipment,
  createEquipmentController
);

/** L'étiquette à imprimer et coller sur le matériel : c'est ce que l'opérateur scannera. */
/**
 * @swagger
 * /api/organization/equipment/{id}/label:
 *   get:
 *     summary: Étiquette scannable d'un matériel (QR code)
 *     description: |
 *       Renvoie le QR code (image PNG) à imprimer et coller sur le matériel. L'opérateur le scanne
 *       pour déclarer où il range un lot.
 *     tags: [Organisation]
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
 *         description: Matériel introuvable dans l'organisation active
 */
router.get(
  '/organization/equipment/:id/label',
  sessionAuth(READ_ROLES),
  getEquipmentLabelController
);

// Données de référence — fournisseurs et emplacements. Écritures réservées à l'administration
// (comme le matériel) : l'admin configure l'usine, l'opérateur reçoit. Archiver ≠ supprimer :
// ces objets sont référencés par des réceptions et du matériel (FK Restrict).
/**
 * @swagger
 * /api/organization/suppliers:
 *   post:
 *     summary: Créer un fournisseur
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nom_ferme, adresse_siege]
 *             properties:
 *               nom_ferme:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 120
 *               adresse_siege:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 200
 *               type_produit:
 *                 type: string
 *                 maxLength: 120
 *               contact_qualite:
 *                 type: string
 *                 maxLength: 120
 *     responses:
 *       201:
 *         description: Fournisseur créé
 *       400:
 *         description: Payload invalide
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant (réservé à owner/admin)
 */
router.post(
  '/organization/suppliers',
  sessionAuth(CONFIG_ROLES),
  validateCreateSupplier,
  createSupplierController
);
/**
 * @swagger
 * /api/organization/suppliers/{id}:
 *   patch:
 *     summary: Modifier un fournisseur
 *     description: Modification partielle. Au moins un champ doit être fourni (sinon 400).
 *     tags: [Organisation]
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
 *             properties:
 *               nom_ferme:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 120
 *               adresse_siege:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 200
 *               type_produit:
 *                 type: string
 *                 maxLength: 120
 *                 nullable: true
 *               contact_qualite:
 *                 type: string
 *                 maxLength: 120
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Fournisseur modifié
 *       400:
 *         description: Payload invalide ou aucune modification fournie
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant (réservé à owner/admin)
 *       404:
 *         description: Fournisseur introuvable dans l'organisation active
 */
router.patch(
  '/organization/suppliers/:id',
  sessionAuth(CONFIG_ROLES),
  validateUpdateSupplier,
  updateSupplierController
);
/**
 * @swagger
 * /api/organization/suppliers/{id}/active:
 *   patch:
 *     summary: Archiver ou réactiver un fournisseur
 *     description: |
 *       Désactivation douce (jamais de suppression : des réceptions passées le référencent).
 *       Un fournisseur archivé ne peut plus recevoir de marchandise.
 *     tags: [Organisation]
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
 *             required: [active]
 *             properties:
 *               active:
 *                 type: boolean
 *                 description: État cible (`true` = réactivé, `false` = archivé)
 *     responses:
 *       200:
 *         description: Fournisseur réactivé ou archivé
 *       400:
 *         description: Payload invalide (`active` manquant ou non booléen)
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant (réservé à owner/admin)
 *       404:
 *         description: Fournisseur introuvable dans l'organisation active
 */
router.patch(
  '/organization/suppliers/:id/active',
  sessionAuth(CONFIG_ROLES),
  validateSetActive,
  setSupplierActiveController
);

/**
 * @swagger
 * /api/organization/locations:
 *   post:
 *     summary: Créer un emplacement (lieu)
 *     description: |
 *       `type` est une chaîne libre (le jeu de démonstration utilise RECEPTION / COLD_STORAGE /
 *       PRODUCTION) : un enum fermé invaliderait ces valeurs à l'édition.
 *
 *       `latitude`/`longitude` sont facultatives mais INDISSOCIABLES : fournir l'une sans l'autre
 *       est refusé en 400. Renseignées, elles sont la seule source du repère affiché sur la fiche
 *       lot ; absentes, la fiche n'affiche pas de carte.
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nom, type]
 *             properties:
 *               nom:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 120
 *               type:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 60
 *               description:
 *                 type: string
 *                 maxLength: 300
 *               latitude:
 *                 type: number
 *                 minimum: -90
 *                 maximum: 90
 *                 description: Requise si `longitude` est fournie
 *               longitude:
 *                 type: number
 *                 minimum: -180
 *                 maximum: 180
 *                 description: Requise si `latitude` est fournie
 *     responses:
 *       201:
 *         description: Emplacement créé
 *       400:
 *         description: Payload invalide
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant (réservé à owner/admin)
 */
router.post(
  '/organization/locations',
  sessionAuth(CONFIG_ROLES),
  validateCreateLocation,
  createLocationController
);
/**
 * @swagger
 * /api/organization/locations/{id}:
 *   patch:
 *     summary: Modifier un emplacement
 *     description: |
 *       Modification partielle. Au moins un champ doit être fourni (sinon 400).
 *
 *       Position : `latitude` et `longitude` se modifient ENSEMBLE, et `null` sur les deux efface la
 *       position. Toute combinaison laissant une moitié de coordonnées — dans le corps comme après
 *       fusion avec l'état en base — est refusée en 400.
 *     tags: [Organisation]
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
 *             properties:
 *               nom:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 120
 *               type:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 60
 *               description:
 *                 type: string
 *                 maxLength: 300
 *                 nullable: true
 *               latitude:
 *                 type: number
 *                 minimum: -90
 *                 maximum: 90
 *                 nullable: true
 *               longitude:
 *                 type: number
 *                 minimum: -180
 *                 maximum: 180
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Emplacement modifié
 *       400:
 *         description: Payload invalide, coordonnées incomplètes, ou aucune modification fournie
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant (réservé à owner/admin)
 *       404:
 *         description: Emplacement introuvable dans l'organisation active
 */
router.patch(
  '/organization/locations/:id',
  sessionAuth(CONFIG_ROLES),
  validateUpdateLocation,
  updateLocationController
);
/**
 * @swagger
 * /api/organization/locations/{id}/active:
 *   patch:
 *     summary: Archiver ou réactiver un emplacement
 *     tags: [Organisation]
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
 *             required: [active]
 *             properties:
 *               active:
 *                 type: boolean
 *                 description: État cible (`true` = réactivé, `false` = archivé)
 *     responses:
 *       200:
 *         description: Emplacement réactivé ou archivé
 *       400:
 *         description: Payload invalide (`active` manquant ou non booléen)
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant (réservé à owner/admin)
 *       404:
 *         description: Emplacement introuvable dans l'organisation active
 */
router.patch(
  '/organization/locations/:id/active',
  sessionAuth(CONFIG_ROLES),
  validateSetActive,
  setLocationActiveController
);

// Clients et produits — mêmes règles : écritures réservées à l'administration, désactivation douce
// (référencés par des expéditions / lots — FK Restrict).
/**
 * @swagger
 * /api/organization/customers:
 *   post:
 *     summary: Créer un client
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nom_enseigne, adresse_livraison]
 *             properties:
 *               nom_enseigne:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 120
 *               adresse_livraison:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 200
 *               contact_urgence:
 *                 type: string
 *                 maxLength: 120
 *               email:
 *                 type: string
 *                 format: email
 *               notes:
 *                 type: string
 *                 maxLength: 500
 *     responses:
 *       201:
 *         description: Client créé
 *       400:
 *         description: Payload invalide
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant (réservé à owner/admin)
 */
router.post(
  '/organization/customers',
  sessionAuth(CONFIG_ROLES),
  validateCreateCustomer,
  createCustomerController
);
/**
 * @swagger
 * /api/organization/customers/{id}:
 *   patch:
 *     summary: Modifier un client
 *     description: Modification partielle. Au moins un champ doit être fourni (sinon 400).
 *     tags: [Organisation]
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
 *             properties:
 *               nom_enseigne:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 120
 *               adresse_livraison:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 200
 *               contact_urgence:
 *                 type: string
 *                 maxLength: 120
 *                 nullable: true
 *               email:
 *                 type: string
 *                 format: email
 *                 nullable: true
 *               notes:
 *                 type: string
 *                 maxLength: 500
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Client modifié
 *       400:
 *         description: Payload invalide ou aucune modification fournie
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant (réservé à owner/admin)
 *       404:
 *         description: Client introuvable dans l'organisation active
 */
router.patch(
  '/organization/customers/:id',
  sessionAuth(CONFIG_ROLES),
  validateUpdateCustomer,
  updateCustomerController
);
/**
 * @swagger
 * /api/organization/customers/{id}/active:
 *   patch:
 *     summary: Archiver ou réactiver un client
 *     tags: [Organisation]
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
 *             required: [active]
 *             properties:
 *               active:
 *                 type: boolean
 *                 description: État cible (`true` = réactivé, `false` = archivé)
 *     responses:
 *       200:
 *         description: Client réactivé ou archivé
 *       400:
 *         description: Payload invalide (`active` manquant ou non booléen)
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant (réservé à owner/admin)
 *       404:
 *         description: Client introuvable dans l'organisation active
 */
router.patch(
  '/organization/customers/:id/active',
  sessionAuth(CONFIG_ROLES),
  validateSetActive,
  setCustomerActiveController
);

/**
 * @swagger
 * /api/organization/products:
 *   post:
 *     summary: Créer un produit (catalogue)
 *     description: |
 *       Tous les champs sont requis (aucun défaut en base). Le GTIN est l'identité GS1 du produit :
 *       il doit être unique dans l'organisation.
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nom, code_gtin, categorie, duree_conservation_defaut, seuil_alerte_stock, unite_reference]
 *             properties:
 *               nom:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 120
 *               code_gtin:
 *                 type: string
 *                 pattern: '^\d{8,14}$'
 *                 description: Identité GS1 (8 à 14 chiffres)
 *               categorie:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 80
 *               duree_conservation_defaut:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 3650
 *                 description: Durée de conservation par défaut, en jours
 *               seuil_alerte_stock:
 *                 type: number
 *                 minimum: 0
 *               unite_reference:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 20
 *     responses:
 *       201:
 *         description: Produit créé
 *       400:
 *         description: Payload invalide
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant (réservé à owner/admin)
 *       409:
 *         description: Un produit avec ce GTIN existe déjà
 */
router.post(
  '/organization/products',
  sessionAuth(CONFIG_ROLES),
  validateCreateProduct,
  createProductController
);
/**
 * @swagger
 * /api/organization/products/{id}:
 *   patch:
 *     summary: Modifier un produit
 *     description: |
 *       Modification partielle. Au moins un champ doit être fourni (sinon 400).
 *
 *       Le GTIN et l'unité de référence ne sont PAS éditables (identité GS1, cohérence des lots) :
 *       ils sont absents du corps accepté.
 *     tags: [Organisation]
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
 *             properties:
 *               nom:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 120
 *               categorie:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 80
 *               duree_conservation_defaut:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 3650
 *               seuil_alerte_stock:
 *                 type: number
 *                 minimum: 0
 *     responses:
 *       200:
 *         description: Produit modifié
 *       400:
 *         description: Payload invalide ou aucune modification fournie
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant (réservé à owner/admin)
 *       404:
 *         description: Produit introuvable dans l'organisation active
 */
router.patch(
  '/organization/products/:id',
  sessionAuth(CONFIG_ROLES),
  validateUpdateProduct,
  updateProductController
);
/**
 * @swagger
 * /api/organization/products/{id}/active:
 *   patch:
 *     summary: Archiver ou réactiver un produit
 *     description: Un produit archivé disparaît des sélections et n'accepte plus ni réception ni production.
 *     tags: [Organisation]
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
 *             required: [active]
 *             properties:
 *               active:
 *                 type: boolean
 *                 description: État cible (`true` = réactivé, `false` = archivé)
 *     responses:
 *       200:
 *         description: Produit réactivé ou archivé
 *       400:
 *         description: Payload invalide (`active` manquant ou non booléen)
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant (réservé à owner/admin)
 *       404:
 *         description: Produit introuvable dans l'organisation active
 */
router.patch(
  '/organization/products/:id/active',
  sessionAuth(CONFIG_ROLES),
  validateSetActive,
  setProductActiveController
);

// Gestion des membres — changer un rôle, révoquer un accès. Réservé aux administrateurs, journalisé.
// On ne cible jamais le propriétaire ni soi-même (cf. member.service). Pas de DELETE (le repo n'en
// utilise aucun) : la révocation est une action POST explicite.
/**
 * @swagger
 * /api/organization/members/{id}/role:
 *   patch:
 *     summary: Changer le rôle d'un membre
 *     description: |
 *       Réattribue le rôle d'un membre. `owner` n'est pas assignable par cette route (pas
 *       d'escalade). On ne cible jamais le propriétaire ni soi-même (403).
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Identifiant du membre (Member.id, Better-Auth)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [admin, quality, operator, viewer]
 *     responses:
 *       200:
 *         description: Rôle mis à jour
 *       400:
 *         description: Payload invalide (rôle absent ou hors énumération)
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant, ou cible interdite (propriétaire ou soi-même)
 *       404:
 *         description: Membre introuvable dans l'organisation active
 */
router.patch(
  '/organization/members/:id/role',
  sessionAuth(CONFIG_ROLES),
  validateChangeMemberRole,
  changeMemberRoleController
);
/**
 * @swagger
 * /api/organization/members/{id}/revoke:
 *   post:
 *     summary: Révoquer l'accès d'un membre
 *     description: |
 *       Supprime le membre, ferme ses sessions et annule ses invitations en attente, dans une seule
 *       transaction journalisée. On ne cible jamais le propriétaire ni soi-même (403).
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Identifiant du membre (Member.id, Better-Auth)
 *     responses:
 *       200:
 *         description: Accès révoqué
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant, ou cible interdite (propriétaire ou soi-même)
 *       404:
 *         description: Membre introuvable dans l'organisation active
 */
router.post('/organization/members/:id/revoke', sessionAuth(CONFIG_ROLES), revokeMemberController);

// Cession de propriété — réservée au propriétaire ACTUEL (OWNER_ONLY_ROLES, pas CONFIG_ROLES : un
// admin ne doit pas pouvoir se déclarer lui-même propriétaire). Transactionnelle et journalisée
// (cf. member.service.transferOwnership) : jamais zéro ni deux propriétaires.
/**
 * @swagger
 * /api/organization/members/{id}/transfer-ownership:
 *   post:
 *     summary: Céder la propriété de l'organisation à un autre membre
 *     description: |
 *       Le membre ciblé devient `owner`, l'appelant (l'actuel propriétaire) redevient `admin` —
 *       atomiquement, dans une seule transaction journalisée. Réservé au propriétaire actuel : ni
 *       un `admin` ni personne d'autre ne peut déclencher cette cession. On ne cible jamais un
 *       membre déjà `owner` ni soi-même (403).
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Identifiant du membre qui devient propriétaire (Member.id, Better-Auth)
 *     responses:
 *       200:
 *         description: Propriété transférée
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant (réservé au propriétaire), cible déjà propriétaire, ou soi-même
 *       404:
 *         description: Membre introuvable dans l'organisation active
 *       409:
 *         description: L'appelant n'est plus propriétaire (cession concurrente) — rechargez la page
 */
router.post(
  '/organization/members/:id/transfer-ownership',
  sessionAuth(OWNER_ONLY_ROLES),
  transferOwnershipController
);

// Passerelles IoT — la clé qui rattache un flux de capteurs à CETTE organisation. Sans ces routes,
// seule l'organisation seedée pouvait surveiller sa chaîne du froid (#93). Réservé à
// l'administration : la clé vaut le droit de mettre des lots en quarantaine.
/**
 * @swagger
 * /api/organization/iot-gateways:
 *   get:
 *     summary: Lister les passerelles IoT de l'organisation
 *     description: |
 *       Renvoie `id`, `nom`, `revoked_at` et `created_at`. La clé en clair n'est jamais renvoyée
 *       ici : la base n'en garde que l'empreinte.
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des passerelles
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant (réservé à owner/admin)
 */
router.get('/organization/iot-gateways', sessionAuth(CONFIG_ROLES), listIotGatewaysController);
/**
 * @swagger
 * /api/organization/iot-gateways:
 *   post:
 *     summary: Créer une passerelle IoT
 *     description: |
 *       Génère une nouvelle passerelle et **rend sa clé en clair une seule fois** (à la création) :
 *       la base n'en garde que l'empreinte, elle est irrécupérable ensuite. La clé vaut le droit de
 *       mettre des lots en quarantaine.
 *     tags: [Organisation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nom]
 *             properties:
 *               nom:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 120
 *     responses:
 *       201:
 *         description: Passerelle créée (la clé en clair n'est renvoyée que dans cette réponse)
 *       400:
 *         description: Payload invalide
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant (réservé à owner/admin)
 */
router.post(
  '/organization/iot-gateways',
  sessionAuth(CONFIG_ROLES),
  validateCreateIotGateway,
  createIotGatewayController
);
/**
 * @swagger
 * /api/organization/iot-gateways/{id}/revoke:
 *   post:
 *     summary: Révoquer une passerelle IoT
 *     description: Idempotent — révoquer une passerelle déjà révoquée n'ajoute pas d'entrée d'audit.
 *     tags: [Organisation]
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
 *         description: Passerelle révoquée
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Rôle insuffisant (réservé à owner/admin)
 *       404:
 *         description: Passerelle introuvable dans l'organisation active
 */
router.post(
  '/organization/iot-gateways/:id/revoke',
  sessionAuth(CONFIG_ROLES),
  revokeIotGatewayController
);

export default router;
