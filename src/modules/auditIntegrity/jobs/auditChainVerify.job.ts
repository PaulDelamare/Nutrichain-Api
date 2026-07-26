import cron from 'node-cron';
import { logger } from '../../../shared/utils/logger/logger';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { advisoryLockKey } from '../../../shared/utils/db/advisoryLockKey';
import { auditVerifyService } from '../services/auditVerify.service';

/**
 * Cron job de vérification d'intégrité de la chaîne d'audit WORM (Objectif SMART n°7).
 *
 * - 4h00 chaque jour (après les cleanups de minuit et 3h).
 * - Verrou consultatif PAR ORGANISATION : `pg_try_advisory_xact_lock` pris DANS la transaction qui
 *   enveloppe la vérification de cette organisation. Si une autre réplique la traite déjà, on passe
 *   à la suivante.
 * - Budget par org : 60s. Au-delà, l'org est skippée avec warn et le job continue.
 * - WORM-safe : aucun `auditService.logAction`. Lecture Audit_Log + écriture Audit_Checkpoint
 *   uniquement (table dédiée, mutable par design).
 *
 * ## Pourquoi un verrou de TRANSACTION, et par organisation (#238)
 *
 * Le job prenait un verrou de SESSION (`pg_try_advisory_lock`) par une requête isolée, puis le
 * relâchait par une seconde requête isolée dans un `finally`. Un verrou de session appartient à la
 * connexion qui l'a pris, or Prisma ne garantit AUCUNE affinité de connexion entre deux appels hors
 * transaction : le `pg_advisory_unlock` partait régulièrement sur une autre connexion du pool et ne
 * relâchait rien. Le verrou restait alors détenu pour toujours, et TOUTE vérification ultérieure —
 * sur toutes les répliques — sortait en silence. L'échec du unlock n'était loggué qu'en `warn`.
 * Même diagnostic, même correctif que `iotAlert.service.ts` : un verrou de transaction est relâché
 * par Postgres au COMMIT comme au ROLLBACK, il ne peut plus fuiter.
 *
 * La granularité passe de « une instance fait tout le run » à « une instance par organisation ».
 * C'est ce qui rend la transaction BORNÉE : elle ne couvre qu'une organisation, donc son `timeout`
 * se déduit du budget déjà en place. Envelopper la boucle entière aurait imposé un timeout
 * arbitraire, à réviser à chaque organisation ajoutée — et tenu une transaction ouverte pendant
 * tout le run, bloquant d'autant le VACUUM sur `Audit_Log`. Deux répliques peuvent désormais se
 * partager les organisations au lieu qu'une seule travaille pendant que les autres passent leur
 * tour ; aucune ne vérifie la même organisation qu'une autre.
 */
const PER_ORG_BUDGET_MS = 60_000;

/**
 * La transaction porte le budget par org : son timeout doit lui survivre, sinon Prisma
 * l'annulerait avant que le `Promise.race` ait pu skipper l'organisation avec son message propre.
 */
const TX_TIMEOUT_MS = PER_ORG_BUDGET_MS + 10_000;
const TX_MAX_WAIT_MS = 10_000;

/** Préfixe d'espace de noms : les verrous consultatifs partagent une seule table de clés. */
const LOCK_NAMESPACE = 'audit-chain-verify';

export async function runAuditChainVerifyOnce(): Promise<void> {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  let dejaEnCours = 0;

  for (const { id } of orgs) {
    // Timer clearé dans finally pour éviter la fuite si verifyChain résout en premier
    // (sinon le setTimeout reste pendant ~60s et la promise rejection est lost).
    let timer: NodeJS.Timeout | undefined;
    try {
      const traitee = await prisma.$transaction(
        async (tx) => {
          const lockRes = await tx.$queryRawUnsafe<{ locked: boolean }[]>(
            `SELECT pg_try_advisory_xact_lock(${advisoryLockKey(LOCK_NAMESPACE, id)}) AS locked`
          );
          if (!lockRes[0]?.locked) {
            return false; // une autre instance vérifie déjà cette organisation
          }

          // `tx` est passé au service : les lectures et le checkpoint empruntent la connexion qui
          // détient le verrou, au lieu d'en mobiliser une seconde pendant que celle-ci attend.
          const result = await Promise.race([
            auditVerifyService.verifyChain({ organizationId: id }, tx),
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
            await auditVerifyService.recordCheckpoint(id, result, tx);
            logger.info(`[AuditVerify] OK org=${id} rows=${result.rowsChecked}`);
          }
          return true;
        },
        { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS }
      );

      if (!traitee) dejaEnCours++;
    } catch (e) {
      logger.warn(`[AuditVerify] Skip org=${id} reason=${(e as Error).message}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  if (dejaEnCours > 0) {
    logger.info(
      `[AuditVerify] Skipped ${dejaEnCours} organisation(s) — déjà vérifiées par une autre instance.`
    );
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
