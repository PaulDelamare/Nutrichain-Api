import { Router } from 'express';
import { requireAuth } from '../../identity/middlewares/requireAuth.middleware';
import { requireOrgRole } from '../../identity/middlewares/requireOrgRole.middleware';
import { verifyAlertAccess } from '../middlewares/verifyAlertAccess.middleware';
import { validateResolveAlert } from '../middlewares/validateResolveAlert.middleware';
import { resolveAlertController } from '../controllers/resolveAlert.controller';
import { listAlertBatchesController } from '../controllers/listAlertBatches.controller';
import { ALL_ROLES, QUALITY_ROLES } from '../../identity/constants/roles.constants';

const router = Router();

/**
 * @swagger
 * /api/alerts/{id}/batches:
 *   get:
 *     summary: Les lots que CETTE alerte a isolés (et qui le sont encore)
 *     description: |
 *       Renvoie les lots mis en quarantaine **par cette alerte** (excursion thermique) et encore
 *       `BLOQUE` — jamais les autres lots bloqués du même équipement.
 *
 *       **Pourquoi cet endpoint existe** : les clients reconstituaient cette liste en filtrant
 *       `GET /api/organization/quarantine-batches` (qui renvoie TOUS les lots `BLOQUE` de
 *       l'organisation) sur l'équipement de l'alerte. Un lot bloqué par un contrôle qualité sans
 *       rapport, mais rangé dans le même frigo, s'y retrouvait — et la levée de l'alerte le
 *       remettait en stock. La liaison lot↔alerte existe en base (`Batch_Mouvement.metadata.id_alerte`
 *       du mouvement `QUARANTAINE_FROID`) : cet endpoint est le seul à la lire.
 *
 *       **`levable`** : faux si le lot porte un contrôle qualité `NON_CONFORME` **postérieur** à son
 *       isolement (il est alors isolé par le froid ET déclaré impropre). Un tel lot ne doit pas être
 *       remis en stock parce que la chambre froide est réparée. `motif_blocage` en donne la raison.
 *
 *       **Multi-tenant / anti-enumeration** : 404 générique si l'alerte n'existe pas ou appartient à
 *       une autre organisation.
 *     tags: [Alertes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: UUID de l'`Alert`
 *     responses:
 *       200:
 *         description: |
 *           Liste (éventuellement vide) des lots isolés par cette alerte et encore en quarantaine.
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Rôle insuffisant
 *       404:
 *         description: Alerte introuvable dans l'organisation active (anti-enumeration)
 */
router.get(
  '/alerts/:id/batches',
  requireAuth,
  requireOrgRole(ALL_ROLES),
  verifyAlertAccess,
  listAlertBatchesController
);

/**
 * @swagger
 * /api/alerts/{id}/resolve:
 *   patch:
 *     summary: Résoudre une alerte (IoT, Recall, etc.)
 *     description: |
 *       Marque une `Alert` comme `RESOLVED`. Capture `resolved_by` (userId session) et `resolved_at` (now).
 *
 *       **Idempotent** : un 2e PATCH sur une Alert déjà RESOLVED renvoie 200 sans aucun audit
 *       supplémentaire (aucune ligne `Audit_Log` n'est créée pour les replays).
 *
 *       **Anti-enumeration** : 404 (pas 403) avec un message générique unique pour les cas
 *       "alerte inexistante", "alerte d'une autre org", "id malformé".
 *
 *       **Multi-tenant** : la résolution n'est possible que pour les `Alert` de l'organisation
 *       active (`req.activeOrgId` après requireOrgRole).
 *
 *       **PRODUCT_RECALL** : si `alert.type === 'PRODUCT_RECALL'`, le message de réponse contient
 *       un warning explicite — la résolution de l'`Alert` NE clôture PAS le `Recall` (le `Batch`
 *       source reste `ALERTE`). Cf. docs/17_alert_resolve.md.
 *
 *       Voir `docs/17_alert_resolve.md` pour le workflow complet et les contraintes PII de la `note`.
 *     tags: [Alertes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: UUID de l'`Alert` à résoudre
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               note:
 *                 type: string
 *                 maxLength: 500
 *                 description: |
 *                   Note libre décrivant la résolution (max 500 chars). Stockée uniquement dans
 *                   l'audit WORM (`Audit_Log.nouvelle_valeur.note`), pas dans le modèle Alert.
 *                   ⚠️ Ne pas saisir d'information PII (nom client, contact, adresse). Classée
 *                   GDPR-containing pour la purge.
 *     responses:
 *       200:
 *         description: |
 *           Alerte résolue (ou déjà résolue — idempotent). Le `message` indique l'état exact.
 *       400:
 *         description: Validation invalide (note > 500 chars, etc.)
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Rôle insuffisant (QUALITY_ROLES — owner, admin ou quality)
 *       404:
 *         description: Alerte introuvable dans l'organisation active (anti-enumeration)
 */
router.patch(
  '/alerts/:id/resolve',
  requireAuth,
  requireOrgRole(QUALITY_ROLES),
  // Access check (`verifyAlertAccess`) AVANT la validation du body : un cross-tenant
  // doit recevoir 404 anti-enum, même si son body était par ailleurs invalide.
  verifyAlertAccess,
  validateResolveAlert,
  resolveAlertController
);

export default router;
