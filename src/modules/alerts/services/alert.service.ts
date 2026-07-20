import { Alert, Prisma } from '@prisma/client';
import { auditService } from '../../../shared/utils/audit/audit.service';
import { retryableTransaction } from '../../../shared/utils/db/withWriteConflictRetry';
import { APIError } from '../../../shared/utils/errorHandler/APIError';

/**
 * Service de résolution d'alertes (PATCH /api/alerts/:id/resolve).
 *
 * Sécurité / Atomicité :
 * - Multi-tenant filtré en amont par verifyAlertAccess (`req.alert` déjà scoped).
 * - Transition ACTIVE → RESOLVED via `updateMany + count` dans une tx Serializable.
 *   `updateMany` est le seul vérificateur d'invariant : un seul winner concurrent passe,
 *   les losers obtiennent count===0 et reçoivent une réponse idempotente sans double audit.
 * - Audit WORM créé UNIQUEMENT sur transition réelle (count===1) — les replays idempotents
 *   ne polluent pas la hash chain.
 * - L'`oldValue` audit est un snapshot complet (statut, resolved_by, resolved_at) construit
 *   depuis l'argument `alert` reçu de verifyAlertAccess, pas un littéral hardcodé : on conserve
 *   le contexte forensique exact pré-update.
 *
 * Cf. plan : `feat/alert-resolve-endpoint` + docs/17_alert_resolve.md.
 */

export interface ResolveAlertParams {
  alert: Alert;
  userId: string;
  note?: string;
}

export interface ResolveAlertResult {
  alert: Alert;
  alreadyResolved: boolean;
}

export const alertService = {
  async resolveAlert(params: ResolveAlertParams): Promise<ResolveAlertResult> {
    const { alert, userId, note } = params;

    // `validateResolveAlert` normalise déjà empty string → undefined avant d'arriver ici.
    const noteNormalized = note ?? null;

    return await retryableTransaction(
      async (tx) => {
        const { count } = await tx.alert.updateMany({
          where: { id: alert.id, statut: 'ACTIVE' },
          data: {
            statut: 'RESOLVED',
            resolved_by: userId,
            resolved_at: new Date(),
          },
        });

        if (count === 0) {
          // Pas de transition (déjà RESOLVED ou perdu la course). Re-fetch pour
          // renvoyer l'état courant. Aucun audit — pas de state change réel.
          const refreshed = await tx.alert.findFirst({
            where: { id: alert.id, organization_id: alert.organization_id },
          });
          if (!refreshed) {
            // verifyAlertAccess l'a trouvée juste avant — disparition = drift inattendu.
            throw new APIError(500, {
              error: [{ field: 'alert', message: "État de l'alerte incohérent (drift)." }],
            });
          }
          return { alert: refreshed, alreadyResolved: true };
        }

        // count === 1 : winner. Fetch fresh + audit dans la même tx.
        // Garde le filtre organization_id par defense-in-depth (cohérent avec la lecture
        // idempotente ci-dessus et avec le pattern iotAlertService).
        const updated = await tx.alert.findFirstOrThrow({
          where: { id: alert.id, organization_id: alert.organization_id },
        });

        await auditService.logAction(
          {
            organizationId: alert.organization_id,
            userId,
            action: 'ALERT_RESOLVED',
            entity: 'Alert',
            entityId: alert.id,
            oldValue: {
              statut: alert.statut,
              resolved_by: alert.resolved_by,
              resolved_at: alert.resolved_at,
            },
            newValue: {
              statut: 'RESOLVED',
              resolved_by: userId,
              resolved_at: updated.resolved_at,
              note: noteNormalized,
            },
          },
          tx
        );

        return { alert: updated, alreadyResolved: false };
      },
      {
        timeout: 10_000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );
  },
};
