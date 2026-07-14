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

router.post('/platform/organizations', validateCreateOrganization, createOrganizationController);
router.get('/platform/organizations', listOrganizationsController);
router.post('/platform/organizations/:id/owner', validateInviteOwner, inviteOwnerController);

export default router;
