import { Prisma } from '@prisma/client';
import { logger } from '../logger/logger';
import { prisma } from '../../configs/prismaClient.config';

/**
 * Nombre maximal de tentatives d'une opération transactionnelle sur conflit d'écriture.
 *
 * Les écritures d'audit d'une même organisation se sérialisent sur une seule chaîne : sous forte
 * concurrence (rafale de scans mobiles + ping IoT), les perdantes se rejouent, et il faut assez de
 * tentatives pour que la dernière de la file passe. 10 tentatives à backoff exponentiel couvrent une
 * rafale réaliste. Au-delà, on préfère échouer (l'opération est rejouable côté client) plutôt que de
 * corrompre la chaîne : l'intégrité prime sur la disponibilité.
 */
const MAX_ATTEMPTS = 10;

/**
 * Un conflit d'écriture est-il retryable ?
 * - `P2034` : Postgres a annulé la transaction pour conflit de sérialisation ou deadlock
 *   (SQLSTATE 40001 / 40P01). C'est le cas nominal de deux transactions Serializable concurrentes.
 * - `P2002` sur la chaîne d'audit : deux écritures concurrentes ont tenté de chaîner sur le même
 *   `prev_hash` et l'index unique `(organization_id, prev_hash)` a rejeté le fork. Re-jouer relit
 *   l'état frais et enchaîne correctement.
 *
 * ⚠️ Tout AUTRE `P2002` (GTIN, SSCC, shipment_id…) est une vraie violation métier, PAS retryable :
 * on le relaie tel quel pour que l'appelant le traduise en 409.
 */
export function isRetryableWriteConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  if (error.code === 'P2002') {
    const target = error.meta?.target;
    const fields = Array.isArray(target) ? target.join(',') : String(target ?? '');
    return fields.includes('prev_hash');
  }
  return false;
}

// Backoff exponentiel plafonné + full jitter : désynchronise la « ruée » de transactions qui
// entrent en conflit en même temps, sans quoi elles se re-percutent en boucle au même instant.
const BASE_BACKOFF_MS = 20;
const MAX_BACKOFF_MS = 500;
const backoffMs = (attempt: number): number => {
  const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));
  return Math.floor(Math.random() * ceiling);
};
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Exécute une opération transactionnelle en la rejouant sur conflit d'écriture retryable
 * (sérialisation, deadlock, fork de la chaîne d'audit).
 *
 * L'opération DOIT être idempotente au rollback : ne l'utiliser que pour envelopper un
 * `prisma.$transaction(...)`, dont l'échec annule tout. JAMAIS autour d'effets de bord non
 * transactionnels (emails, etc.) — ceux-ci restent après la transaction, hors de la zone rejouée.
 */
export async function withWriteConflictRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isRetryableWriteConflict(error)) throw error;
      logger.warn(
        `[db] Conflit d'écriture (tentative ${attempt}/${MAX_ATTEMPTS}), nouvelle tentative`
      );
      await sleep(backoffMs(attempt));
    }
  }
}

type TransactionOptions = {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
};

/**
 * Remplaçant direct de `prisma.$transaction(fn, options)` qui rejoue la transaction sur conflit
 * d'écriture retryable (voir `withWriteConflictRetry`). Même signature — d'où l'usage : partout où
 * une transaction écrit dans la chaîne d'audit WORM, `prisma.$transaction(` devient
 * `retryableTransaction(`.
 */
export function retryableTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: TransactionOptions
): Promise<T> {
  return withWriteConflictRetry(() => prisma.$transaction(fn, options));
}
