import { Router } from 'express';
import { requireAuth } from '../../identity/middlewares/requireAuth.middleware';
import { requireOrgRole } from '../../identity/middlewares/requireOrgRole.middleware';
import { auditVerifyController } from '../controllers/auditVerify.controller';

const router = Router();

/**
 * @swagger
 * /api/audit/verify:
 *   get:
 *     summary: Vérifier l'intégrité de la chaîne d'audit WORM de l'organisation active
 *     description: |
 *       Recompute la SHA256 de chaque ligne Audit_Log de l'org active, vérifie les liens
 *       `prev_hash → signature_hash`, et compare le nombre de lignes au checkpoint persistant
 *       (`Audit_Checkpoint`) pour détecter une troncature silencieuse de la fin de la chaîne.
 *
 *       **Lecture seule** : aucun Audit_Log n'est créé par cette opération. WORM intact.
 *
 *       **Cache-Control: no-store** systématique : l'output dépend de l'état mutable de la chaîne.
 *
 *       Retourne toujours 200 (même `valid: false`) — l'état "broken" est une information,
 *       pas une erreur serveur. Le client doit lire `data.valid` pour décider.
 *
 *       Voir `docs/18_PCA_PRA.md` pour le runbook intégrité + restore.
 *     tags: [Audit]
 *     security:
 *       - apiKeyAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Vérification effectuée (valid:true ou valid:false dans le body)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: integer
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     organizationId: { type: string }
 *                     valid: { type: boolean }
 *                     rowsChecked: { type: integer }
 *                     lastSignatureHash: { type: string, nullable: true }
 *                     lastHorodatage: { type: string, format: date-time, nullable: true }
 *                     lastId: { type: integer, nullable: true }
 *                     brokenAtId: { type: integer, nullable: true }
 *                     brokenAtReason:
 *                       type: string
 *                       enum: [prev_hash_mismatch, signature_mismatch, truncation]
 *                       nullable: true
 *                     expectedRowCount: { type: integer, nullable: true }
 *                     actualRowCount: { type: integer, nullable: true }
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Rôle insuffisant (seuls owner / admin)
 */
router.get('/audit/verify', requireAuth, requireOrgRole(['owner', 'admin']), auditVerifyController);

export default router;
