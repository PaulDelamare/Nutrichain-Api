import cron from 'node-cron';
import { logger } from '../../../shared/utils/logger/logger';
import { MetricsSnapshotModel } from '../models/metricsSnapshot.model';
import { getAndResetAllOrganizationTotals } from '../middlewares/metricsStore';

/**
 * Cron job d'instantané des métriques de requêtes (Observabilité).
 *
 * Le ring buffer en mémoire de `metricsStore` ne survit pas à un redémarrage — inévitable à
 * chaque déploiement. Ce job en écrit un instantané minute par minute dans Mongo (déjà une
 * dépendance obligatoire du projet) pour qu'une tendance survive au process qui l'a produite.
 *
 * Pas de verrou single-instance ici, à la différence d'`auditChainVerify.job` : ce dernier lit
 * une même table Postgres partagée, donc exécuter le check depuis chaque réplique serait
 * redondant. Le trafic capté par `metricsStore` est au contraire un état LOCAL au process — sur
 * un déploiement multi-réplique, chaque instance ne voit que les requêtes qu'elle a personnellement
 * servies. Un verrou choisirait une seule "gagnante" par tick et ferait perdre silencieusement le
 * trafic des autres répliques, qui n'est dupliqué nulle part ailleurs.
 */
export async function runSnapshotMetricsOnce(): Promise<void> {
  const totals = getAndResetAllOrganizationTotals();
  if (totals.length === 0) {
    return;
  }

  const timestamp = new Date();
  const docs = totals.map((t) => ({
    metadata: { organization_id: t.organizationId },
    timestamp,
    request_count: t.count,
    error_count: t.errorCount,
  }));

  try {
    await MetricsSnapshotModel.insertMany(docs);
  } catch (e) {
    logger.warn(`[ObservabilitySnapshot] échec insertMany: ${(e as Error).message}`);
  }
}

export const startSnapshotMetricsJob = (): void => {
  cron.schedule('* * * * *', () => {
    runSnapshotMetricsOnce().catch((err) => {
      logger.error(`[ObservabilitySnapshot] Cron crash: ${(err as Error).message}`);
    });
  });
  logger.info("⏰ Job d'instantané des métriques d'observabilité programmé (chaque minute).");
};
