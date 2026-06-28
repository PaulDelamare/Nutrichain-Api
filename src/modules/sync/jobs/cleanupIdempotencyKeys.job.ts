import cron from 'node-cron';
import { logger } from '../../../shared/utils/logger/logger';
import { prisma } from '../../../shared/configs/prismaClient.config';

/**
 * Purge les IdempotencyKey expirées (TTL ~7j).
 * Garde la table légère pour les requêtes de check (P95 < 50ms).
 * Tourne tous les jours à 3h du matin (heure creuse, après le cleanup invitations à minuit).
 */
export const startCleanupIdempotencyKeysJob = () => {
  cron.schedule('0 3 * * *', async () => {
    try {
      logger.info('[CronTask] Nettoyage des IdempotencyKey expirées...');
      const result = await prisma.idempotencyKey.deleteMany({
        where: { expires_at: { lt: new Date() } },
      });
      if (result.count > 0) {
        logger.info(
          `[CronTask] Nettoyage terminé : ${result.count} clés d'idempotency supprimées.`
        );
      } else {
        logger.info('[CronTask] Nettoyage terminé : aucune clé à supprimer.');
      }
    } catch (error) {
      logger.error(`[CronTask] Erreur lors du nettoyage des IdempotencyKey : ${error}`);
    }
  });

  logger.info('⏰ Job de nettoyage des IdempotencyKey programmé (3h chaque jour).');
};
