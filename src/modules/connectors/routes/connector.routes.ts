import { Router } from 'express';
import express from 'express';
import { sessionAuth } from '../../../shared/middlewares/sessionAuth';
import { ALL_ROLES, ADMIN_ROLES } from '../../identity/constants/roles.constants';
import {
  importProductsController,
  importCustomersController,
  exportEventsController,
} from '../controllers/connector.controller';

const CSV_BODY = express.text({
  type: ['text/csv', 'text/plain', 'application/csv'],
  limit: '5mb',
});

const router = Router();

/**
 * Connecteurs ERP/WMS/TMS — import/export cloisonnés par organisation.
 *
 * Une session administrateur est désormais EXIGÉE : ces routes écrivent le catalogue et le fichier
 * clients. Elles étaient ouvertes à la seule clé API — une clé publique, embarquée dans le bundle
 * mobile. L'auteur de l'import vient de la SESSION et de nulle part ailleurs : chaque ligne écrite
 * est journalisée à son nom, et un appelant ne peut pas désigner qui signe à sa place.
 * Entrant : import de catalogue produit (CSV). Sortant : export des événements EPCIS (CSV).
 */
/**
 * @swagger
 * /api/connectors/imports/products:
 *   post:
 *     summary: Importer un catalogue produit depuis un CSV (connecteur ERP)
 *     description: |
 *       Le corps de la requête est le **CSV brut** (`Content-Type: text/csv`), pas un multipart.
 *
 *       Succès partiel ligne à ligne : une ligne invalide n'annule pas les autres, le rapport
 *       détaille chaque cas. L'upsert est idempotent par `(organisation, code_gtin)`.
 *
 *       Chaque ligne écrite est journalisée dans l'audit WORM avec son état précédent : un import
 *       ne peut plus réécrire le catalogue en silence.
 *
 *       Colonnes : `nom,code_gtin,categorie,duree_conservation_defaut,seuil_alerte_stock,unite_reference`
 *     tags: [Connecteurs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         text/csv:
 *           schema:
 *             type: string
 *           example: |
 *             nom,code_gtin,categorie,duree_conservation_defaut,seuil_alerte_stock,unite_reference
 *             Lait demi-ecreme 1L,3001234567890,Frais,30,10,L
 *     responses:
 *       200:
 *         description: Rapport d'import (total, créés, mis à jour, erreurs, détail par ligne)
 *       400:
 *         description: Corps vide ou Content-Type non text/csv
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Réservé à l'administration de l'organisation
 */
router.post(
  '/connectors/imports/products',
  CSV_BODY,
  sessionAuth(ADMIN_ROLES),
  importProductsController
);

/**
 * @swagger
 * /api/connectors/imports/customers:
 *   post:
 *     summary: Importer un fichier clients depuis un CSV (connecteur ERP)
 *     description: |
 *       Même contrat que l'import produits : CSV brut, succès partiel, upsert idempotent par
 *       `(organisation, external_ref)`, et journalisation WORM de chaque ligne écrite.
 *
 *       `email` et `contact_urgence` sont ce qui sert à joindre le client lors d'un rappel produit :
 *       leur modification est tracée, avec la valeur précédente.
 *
 *       Colonnes obligatoires : `external_ref`, `nom_enseigne`, `adresse_livraison`.
 *       Optionnelles : `email`, `contact_urgence`, `notes`. Une cellule vide vaut « absente » et
 *       n'écrase pas la valeur existante.
 *     tags: [Connecteurs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         text/csv:
 *           schema:
 *             type: string
 *           example: |
 *             external_ref,nom_enseigne,email,contact_urgence,adresse_livraison,notes
 *             ERP-001,Carrefour Nord,contact@carrefour-nord.fr,+33100000000,12 rue du Commerce,
 *     responses:
 *       200:
 *         description: Rapport d'import
 *       400:
 *         description: Corps vide ou Content-Type non text/csv
 *       401:
 *         description: Aucune session
 *       403:
 *         description: Réservé à l'administration de l'organisation
 */
router.post(
  '/connectors/imports/customers',
  CSV_BODY,
  sessionAuth(ADMIN_ROLES),
  importCustomersController
);

router.get('/connectors/exports/events', sessionAuth(ALL_ROLES), exportEventsController);

export default router;
