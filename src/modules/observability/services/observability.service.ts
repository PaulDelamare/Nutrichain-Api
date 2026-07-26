import { prisma } from '../../../shared/configs/prismaClient.config';
import { getRouteStats, RouteStats } from '../middlewares/metricsStore';

/** Fenêtre d'agrégation des compteurs métier — pas de pagination ni de plage libre : YAGNI tant qu'un seul écran l'affiche. */
const OBSERVABILITY_WINDOW_HOURS = 24;

export interface AlertBreakdown {
  type: string;
  statut: string;
  count: number;
}

export interface DashboardMetrics {
  requestLatency: RouteStats[];
  auditEntryCount: number;
  alerts: AlertBreakdown[];
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

    return {
      requestLatency: getRouteStats(organizationId),
      auditEntryCount,
      alerts: alertGroups.map((group) => ({
        type: group.type,
        statut: group.statut,
        count: group._count._all,
      })),
      windowHours: OBSERVABILITY_WINDOW_HOURS,
    };
  },
};
