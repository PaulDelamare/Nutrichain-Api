import { Router } from 'express';
import { syncScansController } from '../controllers/syncScans.controller';
import { validateSyncScans } from '../middlewares/validateSyncScans.middleware';
import { sessionAuth } from '../../../shared/middlewares/sessionAuth';
import { SYNC_WRITE_ROLES } from '../constants/sync.constants';

const router = Router();

/**
 * @swagger
 * /api/sync/scans:
 *   post:
 *     summary: Bulk sync mobile offline-first
 *     description: |
 *       Endpoint de synchronisation bulk pour les scans accumulés offline par
 *       l'application mobile (Objectif SMART n°4, latence ingest < 500 ms).
 *
 *       - Idempotency par item via `clientOpId` (UUID généré par le mobile,
 *         identique sur retry → pas de doublon)
 *       - Réponse **HTTP 207 Multi-Status** : chaque item a son propre `status`
 *         (`ok` / `error` / `conflict`)
 *       - Périmètre v1 : opérations `type: 'receipt'` (création de réception)
 *       - Auth : session (Web/Mobile via Bearer/Cookie) ou clé API (M2M).
 *         En M2M, `actorUserId` est requis et doit pointer vers un membre de
 *         l'org bound avec un rôle ∈ SYNC_WRITE_ROLES.
 *       - Atomicité : chaque item est traité dans une transaction Serializable
 *         (idempotency claim → receipt + batch → audit WORM), rollback complet
 *         en cas d'échec.
 *
 *       Voir `docs/14_sync_mobile_offline.md` pour le contrat complet,
 *       le workflow de retry mobile et les codes d'erreur.
 *     tags: [Sync]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             properties:
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 100
 *                 items:
 *                   type: object
 *                   required: [clientOpId, type, payload]
 *                   properties:
 *                     clientOpId:
 *                       type: string
 *                       format: uuid
 *                       description: UUID v4 généré par le mobile, identique sur retry
 *                     type:
 *                       type: string
 *                       enum: [receipt]
 *                     payload:
 *                       type: object
 *                       description: Charge utile selon le type (cf. validateReceipt pour 'receipt')
 *               actorUserId:
 *                 type: string
 *                 format: uuid
 *                 description: |
 *                   Optionnel. Requis en mode M2M (clé API) pour identifier l'opérateur.
 *                   Ignoré en mode session (utilisateur résolu depuis req.auth).
 *     responses:
 *       207:
 *         description: |
 *           Multi-Status. Chaque item a été traité indépendamment ; voir `data.results[].status`.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: integer
 *                   example: 207
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     results:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           clientOpId:
 *                             type: string
 *                           status:
 *                             type: string
 *                             enum: [ok, error, conflict]
 *                           serverId:
 *                             type: object
 *                             nullable: true
 *                             properties:
 *                               receiptId:
 *                                 type: string
 *                               batchId:
 *                                 type: string
 *                           error:
 *                             type: object
 *                             nullable: true
 *                             properties:
 *                               field:
 *                                 type: string
 *                               message:
 *                                 type: string
 *                     summary:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: integer
 *                         ok:
 *                           type: integer
 *                         error:
 *                           type: integer
 *                         conflict:
 *                           type: integer
 *       400:
 *         description: Payload invalide (items vide, > 100, clientOpId non-UUID, etc.) ou actorUserId manquant en M2M
 *       401:
 *         description: Non authentifié
 *       403:
 *         description: Rôle insuffisant ou actorUserId non membre de l'org
 */
router.post('/sync/scans', sessionAuth(SYNC_WRITE_ROLES), validateSyncScans, syncScansController);

export default router;
