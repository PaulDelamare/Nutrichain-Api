import { describe, it, expect, vi, beforeEach } from 'vitest';
import { observabilityService } from './observability.service';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { recordRequestSample, resetMetricsStore } from '../middlewares/metricsStore';

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    audit_Log: { count: vi.fn() },
    alert: { groupBy: vi.fn() },
  },
}));

const orgId = 'org-123';

describe('observabilityService.getDashboardMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMetricsStore();
    vi.mocked(prisma.audit_Log.count).mockResolvedValue(0);
    vi.mocked(prisma.alert.groupBy).mockResolvedValue([]);
  });

  it("1. filtre le journal d'audit et les alertes par organizationId, sur la fenêtre 24h", async () => {
    await observabilityService.getDashboardMetrics({ organizationId: orgId });

    expect(prisma.audit_Log.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organization_id: orgId,
          horodatage: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      })
    );
    expect(prisma.alert.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['type', 'statut'],
        where: expect.objectContaining({
          organization_id: orgId,
          created_at: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      })
    );
  });

  it('2. agrège les échantillons de latence du ring buffer en mémoire, pour cette organisation', async () => {
    recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 200, durationMs: 10, organizationId: orgId, timestamp: Date.now() });
    recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 200, durationMs: 20, organizationId: orgId, timestamp: Date.now() });

    const result = await observabilityService.getDashboardMetrics({ organizationId: orgId });

    expect(result.requestLatency).toHaveLength(1);
    expect(result.requestLatency[0]).toMatchObject({ route: '/api/catalog', method: 'GET', count: 2 });
  });

  it("5. cloisonnement : la latence d'une autre organisation n'apparaît jamais dans le résultat", async () => {
    recordRequestSample({
      route: '/api/organization/recall',
      method: 'POST',
      statusCode: 200,
      durationMs: 5,
      organizationId: 'org-autre',
      timestamp: Date.now(),
    });

    const result = await observabilityService.getDashboardMetrics({ organizationId: orgId });

    expect(result.requestLatency).toEqual([]);
  });

  it("3. retourne le total d'entrées d'audit et le détail des alertes par type/statut", async () => {
    vi.mocked(prisma.audit_Log.count).mockResolvedValue(7);
    vi.mocked(prisma.alert.groupBy).mockResolvedValue([
      { type: 'TEMP_EXCURSION', statut: 'ACTIVE', _count: { _all: 3 } },
      { type: 'PRODUCT_RECALL', statut: 'RESOLVED', _count: { _all: 1 } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    const result = await observabilityService.getDashboardMetrics({ organizationId: orgId });

    expect(result.auditEntryCount).toBe(7);
    expect(result.alerts).toEqual([
      { type: 'TEMP_EXCURSION', statut: 'ACTIVE', count: 3 },
      { type: 'PRODUCT_RECALL', statut: 'RESOLVED', count: 1 },
    ]);
  });

  it('4. aucune donnée : tableaux vides, compteur à 0, pas de crash', async () => {
    const result = await observabilityService.getDashboardMetrics({ organizationId: orgId });

    expect(result.auditEntryCount).toBe(0);
    expect(result.alerts).toEqual([]);
    expect(result.requestLatency).toEqual([]);
  });

  it('6. kpis : totalRequests/errorRate agrégés depuis le ring buffer, activeAlertCount depuis les alertes ACTIVE uniquement', async () => {
    recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 200, durationMs: 5, organizationId: orgId, timestamp: Date.now() });
    recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 500, durationMs: 5, organizationId: orgId, timestamp: Date.now() });
    recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 200, durationMs: 5, organizationId: orgId, timestamp: Date.now() });
    vi.mocked(prisma.audit_Log.count).mockResolvedValue(7);
    vi.mocked(prisma.alert.groupBy).mockResolvedValue([
      { type: 'TEMP_EXCURSION', statut: 'ACTIVE', _count: { _all: 3 } },
      { type: 'PRODUCT_RECALL', statut: 'RESOLVED', _count: { _all: 1 } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    const result = await observabilityService.getDashboardMetrics({ organizationId: orgId });

    expect(result.kpis).toEqual({
      totalRequests: 3,
      errorRate: 1 / 3,
      auditEntryCount: 7,
      activeAlertCount: 3,
    });
  });

  it('7. kpis.errorRate = 0 quand il n’y a aucune requête (pas de division par zéro)', async () => {
    const result = await observabilityService.getDashboardMetrics({ organizationId: orgId });

    expect(result.kpis.errorRate).toBe(0);
  });

  it('8. requestVolumeSeries : une fenêtre de 30 buckets (30 minutes, 1 par minute)', async () => {
    const result = await observabilityService.getDashboardMetrics({ organizationId: orgId });

    expect(result.requestVolumeSeries).toHaveLength(30);
  });

  it("9. requestVolumeSeries : cloisonnée par organisation, comme la latence", async () => {
    recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 200, durationMs: 5, organizationId: 'org-autre', timestamp: Date.now() });

    const result = await observabilityService.getDashboardMetrics({ organizationId: orgId });

    expect(result.requestVolumeSeries.reduce((sum, b) => sum + b.count, 0)).toBe(0);
  });
});
