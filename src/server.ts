import { logger } from './shared/utils/logger/logger';
// ! IMPORTS
import { app } from './app';
import { bdd } from './shared/configs/prismaClient.config';
import { connectMongoDB, disconnectMongoDB } from './shared/configs/mongoClient.config';
import { startCleanupJob } from './modules/identity/jobs/cleanupInvitations.job';

// ! CONFIG
const PORT = process.env.PORT || 3000;
const API_URL = process.env.API_URL;

// ! INITIALISATION
connectMongoDB()
  .then(() => {
    const server = app.listen(PORT, () => {
      logger.info(`Server running on ${API_URL}`);

      // Lancement des tÃ¢ches rÃ©currentes (Cron, Background Jobs)
      startCleanupJob();
    });

    // ! FERMETURE
    process.on('SIGINT', async () => {
      logger.info('Server shutdown...');
      await bdd.$disconnect();
      await disconnectMongoDB();
      server.close(() => {
        logger.info('Server stopped successfully.');
        process.exit(0);
      });
    });
  })
  .catch(console.error);
