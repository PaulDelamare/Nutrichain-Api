import { Router } from "express";
import { checkApiKey } from "../../../shared/utils/checkApiKey/checkApiKey";
import { requireAuth } from "../middlewares/requireAuth.middleware";
import { validateInvitationParams } from "../middlewares/validateInvitation.middleware";
import { generateInvitation } from "../controllers/invitation.controller";

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
    "/identity/invitations",
    checkApiKey(),                // 1. Clé d'API requise
    requireAuth,                  // 2. Doit être identifié en tant qu'utilisateur (Token ou Cookie)
    validateInvitationParams,     // 3. Email propre ? Rôle dans la liste ? UUID correct pour Zone ?
    generateInvitation            // 4. Exécution du contrôleur (Créer DB + Envoyer l'email)
);

export default router;
