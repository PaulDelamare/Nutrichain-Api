import cron from 'node-cron';
import { logger } from '../../../shared/utils/logger/logger';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { auditVerifyService } from '../services/auditVerify.service';

/**
 * Cron job de vérification d'intégrité de la chaîne d'audit WORM (Objectif SMART n°7).
 *
 * - 4h00 chaque jour (après les cleanups de minuit et 3h).
 * - Advisory lock single-instance : `pg_try_advisory_lock(ADVISORY_LOCK_KEY)` au démarrage.
 *   Si déjà tenu (autre pod multi-réplique), skip silencieux.
 * - Budget per-org : 60s. Au-delà, l'org est skippée avec warn et le job continue.
 * - WORM-safe : aucun `auditService.logAction`. Lecture Audit_Log + écriture Audit_Checkpoint
 *   uniquement (table dédiée, mutable par design).
 */
export const PER_ORG_BUDGET_MS = 60_000;
export const ADVISORY_LOCK_KEY = 9_999_117; // arbitraire, exporté pour les tests

export async function runAuditChainVerifyOnce(): Promise<void> {
  const lockRes = await prisma.$queryRawUnsafe<{ locked: boolean }[]>(
    `SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS locked`
  );
  if (!lockRes[0]?.locked) {
    logger.info('[AuditVerify] Skipped — another instance holds the advisory lock.');
    return;
  }
  try {
    const orgs = await prisma.organization.findMany({ select: { id: true } });
    for (const { id } of orgs) {
      // Timer clearé dans finally pour éviter la fuite si verifyChain résout en premier
      // (sinon le setTimeout reste pendant ~60s et la promise rejection est lost).
      let timer: NodeJS.Timeout | undefined;
      try {
        const result = await Promise.race([
          auditVerifyService.verifyChain({ organizationId: id }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('per-org budget exceeded')),
              PER_ORG_BUDGET_MS
            );
          }),
        ]);
        if (!result.valid) {
          logger.error(
            `[AuditVerify] CORROMPUE org=${id} brokenAtId=${result.brokenAtId} reason=${result.brokenAtReason}`
          );
        } else {
          await auditVerifyService.recordCheckpoint(id, result);
          logger.info(`[AuditVerify] OK org=${id} rows=${result.rowsChecked}`);
        }
      } catch (e) {
        logger.warn(`[AuditVerify] Skip org=${id} reason=${(e as Error).message}`);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  } finally {
    // Toujours tenter de release le lock, même si la connexion a flaké pendant la boucle.
    // `.catch` au lieu de `try/await` pour ne pas masquer une erreur du `try` parent.
    await prisma
      .$queryRawUnsafe(`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`)
      .catch((e) => logger.warn(`[AuditVerify] unlock failed: ${(e as Error).message}`));
  }
}

export const startAuditChainVerifyJob = (): void => {
  cron.schedule('0 4 * * *', () => {
    runAuditChainVerifyOnce().catch((err) => {
      logger.error(`[AuditVerify] Cron crash: ${(err as Error).message}`);
    });
  });
  logger.info("⏰ Job de vérification de la chaîne d'audit programmé (4h00 chaque jour).");
};
