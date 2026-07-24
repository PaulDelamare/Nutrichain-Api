import cron from 'node-cron';
import { logger } from '../../../shared/utils/logger/logger';
import { prisma } from '../../../shared/configs/prismaClient.config';

/** Au-delà, une ligne ne freine plus rien : la fenêtre de comptage est de 15 minutes. */
const RETENTION_HOURS = 24;

/**
 * Purge les compteurs de tentatives de connexion.
 *
 * Une ligne est créée pour TOUTE adresse ayant échoué, y compris inexistante : sans purge, un
 * balayage d'adresses aléatoires ferait grossir la table indéfiniment, par un appelant non
 * authentifié. La purge borne aussi la conservation d'une donnée pseudonymisée, qui n'a aucune
 * raison de survivre à la fenêtre qu'elle sert.
 *
 * Tourne à 3h30, après la purge des clés d'idempotency.
 */
export const startCleanupLoginAttemptsJob = () => {
  cron.schedule('30 3 * * *', async () => {
    try {
      logger.info('[CronTask] Nettoyage des compteurs de tentatives de connexion...');
      const threshold = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000);

      const result = await prisma.loginAttempt.deleteMany({
        where: {
          updated_at: { lt: threshold },
          // Un verrou encore actif ne se purge pas : ce serait déverrouiller un compte attaqué.
          OR: [{ locked_until: null }, { locked_until: { lt: new Date() } }],
        },
      });

      logger.info(
        result.count > 0
          ? `[CronTask] Nettoyage terminé : ${result.count} compteur(s) de connexion supprimé(s).`
          : '[CronTask] Nettoyage terminé : aucun compteur à supprimer.'
      );
    } catch (error) {
      logger.error(`[CronTask] Erreur lors du nettoyage des tentatives de connexion : ${error}`);
    }
  });

  logger.info('⏰ Job de nettoyage des tentatives de connexion programmé (3h30 chaque jour).');
};
