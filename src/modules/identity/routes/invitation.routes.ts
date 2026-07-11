import { Router } from 'express';
import { checkApiKey } from '../../../shared/utils/checkApiKey/checkApiKey';
import { requireAuth } from '../middlewares/requireAuth.middleware';
import { requireOrgRole } from '../middlewares/requireOrgRole.middleware';
import { validateInvitationParams } from '../middlewares/validateInvitation.middleware';
import { generateInvitation, previewInvitation } from '../controllers/invitation.controller';
import { ADMIN_ROLES } from '../constants/roles.constants';

const router = Router();

/**
 * @swagger
 * /api/identity/invitations:
 *   post:
 *     summary: Générer une invitation (Envoyer un email) - ADMIN
 *     tags: [Identité, Invitations]
 *     security:
 *       - apiKeyAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 example: "new.operator@usine.com"
 *               role:
 *                 type: string
 *                 enum: [owner, admin, manager, operator]
 *                 example: "operator"
 *               organizationId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Invitation créée et email envoyé.
 *       400:
 *         description: Mauvais format VineJS ou Utilisateur existant déjà.
 *       401:
 *         description: Non authentifié.
 */
router.post(
  '/identity/invitations',
  checkApiKey(), // 1. Clé d'API requise
  requireAuth, // 2. Doit être identifié en tant qu'utilisateur (Token ou Cookie)
  requireOrgRole(ADMIN_ROLES), // 3. ABAC : Doit être un admin/owner de l'organisation active
  validateInvitationParams, // 4. Email propre ? RÃ´le dans la liste ? UUID correct pour Zone ?
  generateInvitation // 5. ExÃ©cution du contrÃ´leur (CrÃ©er DB + Envoyer l'email)
);

// Prévisualisation d'une invitation depuis la page d'inscription (pas encore de
// session utilisateur) : protégée par la clé API seulement.
router.get('/identity/invitations/:token/preview', checkApiKey(), previewInvitation);

export default router;
