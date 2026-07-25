import { Router } from 'express';
import { checkApiKey } from '../../../shared/utils/checkApiKey/checkApiKey';
import { requireAuth } from '../middlewares/requireAuth.middleware';
import { deleteMyAccountController } from '../controllers/account.controller';

const router = Router();

/**
 * @swagger
 * /api/identity/me:
 *   delete:
 *     summary: Anonymiser son propre compte (droit à l'effacement RGPD)
 *     description: |
 *       Anonymise (email, nom) plutôt que supprimer : `User.id` reste référencé par les tables
 *       métier et par l'audit WORM. Coupe toute session et tout identifiant de connexion.
 *       Refusé (409) si l'appelant est encore propriétaire d'une organisation — transférer la
 *       propriété d'abord (`POST /organization/members/:id/transfer-ownership`).
 *     tags: [Identité]
 *     security:
 *       - apiKeyAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Compte anonymisé.
 *       401:
 *         description: Non authentifié.
 *       409:
 *         description: Propriétaire d'une organisation — transfert de propriété requis d'abord.
 */
router.delete('/identity/me', checkApiKey(), requireAuth, deleteMyAccountController);

export default router;
