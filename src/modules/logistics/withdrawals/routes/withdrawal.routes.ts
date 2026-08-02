import { Router } from 'express';
import { sessionAuth } from '../../../../shared/middlewares/sessionAuth';
import { ALL_ROLES, ROLES, Role } from '../../../identity/constants/roles.constants';
import { recordWithdrawal, listWithdrawals } from '../controllers/withdrawal.controller';
import {
  validateWithdrawal,
  validateWithdrawalList,
} from '../middlewares/validateWithdrawal.middleware';

const router = Router();

/**
 * Déclarer un retrait est un fait rapporté par un magasin, pas une décision qualité : l'opérateur
 * qui prend l'appel doit pouvoir l'enregistrer. `WRITE_ROLES` seul exclurait `quality`, c'est-à-dire
 * précisément le rôle qui conduit un rappel. Seul le `viewer` en est écarté.
 */
const WITHDRAWAL_WRITE_ROLES: Role[] = [ROLES.OWNER, ROLES.ADMIN, ROLES.QUALITY, ROLES.OPERATOR];

/**
 * @swagger
 * /api/logistics/batches/{id}/withdrawals:
 *   post:
 *     summary: Enregistrer le retrait d'un lot du rayon d'un magasin
 *     description: |
 *       Geste distinct de la mise au rebut, et répétable : un magasin peut retirer en plusieurs
 *       fois. La quantité cumulée ne peut pas dépasser ce qui a été LIVRÉ à ce client pour ce lot.
 *       Le statut du lot n'est pas modifié.
 *     tags: [Logistique]
 *     responses:
 *       201:
 *         description: Retrait enregistré
 *       404:
 *         description: Lot ou client introuvable dans l'organisation active
 *       409:
 *         description: Rien n'a été livré à ce client, ou le cumul dépasse la quantité livrée
 */
router.post(
  '/logistics/batches/:id/withdrawals',
  sessionAuth(WITHDRAWAL_WRITE_ROLES),
  validateWithdrawal,
  recordWithdrawal
);

/**
 * @swagger
 * /api/logistics/batches/{id}/withdrawals:
 *   get:
 *     summary: Avancement du retrait d'un lot, par magasin
 *     description: |
 *       Livré, déjà retiré et reste à retirer pour chaque client. Le reste est calculé ici, avec la
 *       règle qui gouverne l'écriture — le recalculer à l'écran le ferait diverger.
 *     tags: [Logistique]
 *     responses:
 *       200:
 *         description: Avancement par client
 *       404:
 *         description: Lot introuvable dans l'organisation active
 */
router.get(
  '/logistics/batches/:id/withdrawals',
  sessionAuth(ALL_ROLES),
  validateWithdrawalList,
  listWithdrawals
);

export default router;
