import { logger } from '../../../shared/utils/logger/logger';
import cron from 'node-cron';
import { bdd } from '../../../shared/configs/prismaClient.config';

/**
 * Nettoie les invitations qui sont stockées dans la base de données
 * mais dont la date d'expiration a été dépassée (sans qu'elles n'aient été acceptées).
 */
export const startCleanupJob = () => {
  // S'exécute tous les jours à Minuit ("0 0 * * *")
  cron.schedule('0 0 * * *', async () => {
    try {
      logger.info('[CronTask] Lancement du nettoyage des invitations expirées...');
      const result = await bdd.invitation.deleteMany({
        where: {
          status: 'pending',
          expiresAt: { lt: new Date() },
        },
      });
      if (result.count > 0) {
        logger.info(`[CronTask] Nettoyage terminé : ${result.count} invitations supprimées.`);
      } else {
        logger.info('[CronTask] Nettoyage terminé : Aucune invitation à supprimer.');
      }
    } catch (error) {
      console.error('[CronTask] Erreur lors du nettoyage :', error);
    }
  });

  logger.info('⏰ Job de nettoyage des Invitations programmé (Minuit chaque jour).');
};
