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
router.post(
  '/connectors/imports/products',
  CSV_BODY,
  sessionAuth(ADMIN_ROLES),
  importProductsController
);

router.post(
  '/connectors/imports/customers',
  CSV_BODY,
  sessionAuth(ADMIN_ROLES),
  importCustomersController
);

router.get('/connectors/exports/events', sessionAuth(ALL_ROLES), exportEventsController);

export default router;
