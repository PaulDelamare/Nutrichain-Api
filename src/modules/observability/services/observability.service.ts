import { prisma } from '../../../shared/configs/prismaClient.config';
import { getRouteStats, getRequestVolumeSeries, RouteStats, RequestVolumeBucket } from '../middlewares/metricsStore';

/** Fenêtre d'agrégation des compteurs métier — pas de pagination ni de plage libre : YAGNI tant qu'un seul écran l'affiche. */
const OBSERVABILITY_WINDOW_HOURS = 24;

/** Fenêtre de la série temporelle de volume : 30 minutes, un point par minute. */
const VOLUME_SERIES_WINDOW_MINUTES = 30;
const VOLUME_SERIES_BUCKET_MINUTES = 1;

export interface AlertBreakdown {
  type: string;
  statut: string;
  count: number;
}

export interface DashboardKpis {
  totalRequests: number;
  errorRate: number;
  auditEntryCount: number;
  activeAlertCount: number;
}

export interface DashboardMetrics {
  requestLatency: RouteStats[];
  requestVolumeSeries: RequestVolumeBucket[];
  auditEntryCount: number;
  alerts: AlertBreakdown[];
  kpis: DashboardKpis;
  windowHours: number;
}

const windowStart = (): Date => new Date(Date.now() - OBSERVABILITY_WINDOW_HOURS * 60 * 60 * 1000);

export const observabilityService = {
  async getDashboardMetrics({ organizationId }: { organizationId: string }): Promise<DashboardMetrics> {
    const since = windowStart();

    const [auditEntryCount, alertGroups] = await Promise.all([
      prisma.audit_Log.count({
        where: { organization_id: organizationId, horodatage: { gte: since } },
      }),
      prisma.alert.groupBy({
        by: ['type', 'statut'],
        where: { organization_id: organizationId, created_at: { gte: since } },
        _count: { _all: true },
      }),
    ]);

    const requestLatency = getRouteStats(organizationId);
    const requestVolumeSeries = getRequestVolumeSeries(organizationId, {
      bucketMinutes: VOLUME_SERIES_BUCKET_MINUTES,
      windowMinutes: VOLUME_SERIES_WINDOW_MINUTES,
      now: Date.now(),
    });
    const alerts = alertGroups.map((group) => ({
      type: group.type,
      statut: group.statut,
      count: group._count._all,
    }));

    const totalRequests = requestLatency.reduce((sum, r) => sum + r.count, 0);
    const totalErrors = requestLatency.reduce((sum, r) => sum + r.errorCount, 0);
    const activeAlertCount = alerts
      .filter((a) => a.statut === 'ACTIVE')
      .reduce((sum, a) => sum + a.count, 0);

    return {
      requestLatency,
      requestVolumeSeries,
      auditEntryCount,
      alerts,
      kpis: {
        totalRequests,
        errorRate: totalRequests === 0 ? 0 : totalErrors / totalRequests,
        auditEntryCount,
        activeAlertCount,
      },
      windowHours: OBSERVABILITY_WINDOW_HOURS,
    };
  },
};
