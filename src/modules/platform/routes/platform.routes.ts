import { Router } from 'express';
import { checkApiKey } from '../../../shared/utils/checkApiKey/checkApiKey';
import { requirePlatformAdmin } from '../../identity/middlewares/requirePlatformAdmin.middleware';
import { validateCreateOrganization, validateInviteOwner } from '../middlewares/platform.schema';
import {
  createOrganizationController,
  listOrganizationsController,
  inviteOwnerController,
} from '../controllers/platform.controller';

const router = Router();

// Toutes les routes plateforme : clé API (application) + session d'un admin de PLATEFORME.
// Volontairement hors `sessionAuth` : pas d'organisation active — l'admin de plateforme n'a et ne
// doit avoir accès à aucune donnée métier d'un client.
router.use('/platform', checkApiKey(), requirePlatformAdmin);

/**
 * @swagger
 * /api/platform/organizations:
 *   post:
 *     summary: Créer une organisation cliente (personnel plateforme)
 *     description: |
 *       Crée une organisation et scelle l'acte fondateur dans SA PROPRE chaîne d'audit WORM
 *       (`prev_hash = GENESIS`), écriture et journalisation dans la même transaction.
 *
 *       Route de PLATEFORME : exige à la fois la clé `x-api-key` (application) ET la session d'un
 *       administrateur de plateforme. Aucune organisation active n'est requise — le personnel
 *       plateforme n'a accès à aucune donnée métier d'un client.
 *     tags: [Plateforme]
 *     security:
 *       - apiKeyAuth: []
 *         bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, slug]
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 120
 *               slug:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 60
 *                 pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$'
 *                 description: |
 *                   Libellé court identifiant l'organisation dans l'URL : minuscules, chiffres et
 *                   tirets uniquement. Normalisé en minuscules avant validation.
 *               gs1_company_prefix:
 *                 type: string
 *                 pattern: '^\d{6,12}$'
 *                 description: Préfixe entreprise GS1 (6 à 12 chiffres). Optionnel.
 *     responses:
 *       201:
 *         description: Organisation créée
 *       400:
 *         description: Payload invalide (messages en français, orientés champ)
 *       401:
 *         description: |
 *           Clé `x-api-key` absente ou invalide, ou aucune session. La clé seule ne suffit pas :
 *           elle identifie une application, elle n'autorise personne.
 *       403:
 *         description: Réservé aux administrateurs de la plateforme
 *       409:
 *         description: Le slug est déjà utilisé
 */
router.post('/platform/organizations', validateCreateOrganization, createOrganizationController);

/**
 * @swagger
 * /api/platform/organizations:
 *   get:
 *     summary: Lister toutes les organisations (personnel plateforme)
 *     description: |
 *       Renvoie chaque organisation avec son NOMBRE de membres, jamais leur identité : l'admin de
 *       plateforme ne voit pas l'annuaire d'un client. Exige la clé `x-api-key` ET la session d'un
 *       administrateur de plateforme.
 *     tags: [Plateforme]
 *     security:
 *       - apiKeyAuth: []
 *         bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des organisations (id, name, slug, createdAt, membersCount)
 *       401:
 *         description: Clé `x-api-key` absente ou invalide, ou aucune session
 *       403:
 *         description: Réservé aux administrateurs de la plateforme
 */
router.get('/platform/organizations', listOrganizationsController);

/**
 * @swagger
 * /api/platform/organizations/{id}/owner:
 *   post:
 *     summary: Inviter le premier pilote (owner) d'une organisation
 *     description: |
 *       Envoie l'invitation du PREMIER owner d'une organisation. C'est le seul chemin qui pose un
 *       rôle `owner` : l'invitation par un admin d'organisation en est incapable (owner est exclu
 *       des rôles invitables). Un pilote unique est garanti — la route refuse si l'organisation a
 *       déjà un membre en place ou une invitation d'owner en attente.
 *
 *       Exige la clé `x-api-key` ET la session d'un administrateur de plateforme.
 *     tags: [Plateforme]
 *     security:
 *       - apiKeyAuth: []
 *         bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Identifiant de l'organisation cible
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       201:
 *         description: Invitation envoyée au premier pilote de l'organisation
 *       400:
 *         description: E-mail invalide
 *       401:
 *         description: Clé `x-api-key` absente ou invalide, ou aucune session
 *       403:
 *         description: Réservé aux administrateurs de la plateforme
 *       404:
 *         description: L'organisation demandée n'existe pas
 *       409:
 *         description: L'organisation a déjà un pilote (membre en place ou invitation en attente)
 */
router.post('/platform/organizations/:id/owner', validateInviteOwner, inviteOwnerController);

export default router;
