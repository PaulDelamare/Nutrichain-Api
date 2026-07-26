import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordRequestSample,
  getRouteStats,
  getRequestVolumeSeries,
  resetMetricsStore,
} from './metricsStore';

const orgA = 'org-a';
const orgB = 'org-b';

describe('metricsStore', () => {
  beforeEach(() => {
    resetMetricsStore();
  });

  it('1. aucune donnée : getRouteStats(orgA) retourne []', () => {
    expect(getRouteStats(orgA)).toEqual([]);
  });

  it('2. un échantillon : count=1, p50/p95/p99 = la seule valeur, errorCount=0', () => {
    recordRequestSample({
      route: '/api/catalog',
      method: 'GET',
      statusCode: 200,
      durationMs: 42,
      organizationId: orgA,
      timestamp: 1000,
    });

    const stats = getRouteStats(orgA);

    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({
      route: '/api/catalog',
      method: 'GET',
      count: 1,
      errorCount: 0,
      p50: 42,
      p95: 42,
      p99: 42,
    });
  });

  it('3. p50/p95/p99 corrects sur 100 échantillons uniformes (1..100ms)', () => {
    for (let ms = 1; ms <= 100; ms += 1) {
      recordRequestSample({
        route: '/api/catalog',
        method: 'GET',
        statusCode: 200,
        durationMs: ms,
        organizationId: orgA,
        timestamp: 1000 + ms,
      });
    }

    const [stats] = getRouteStats(orgA);

    expect(stats.count).toBe(100);
    expect(stats.p50).toBe(50);
    expect(stats.p95).toBe(95);
    expect(stats.p99).toBe(99);
  });

  it('4. statusCode >= 500 compté dans errorCount, pas 4xx', () => {
    recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 500, durationMs: 10, organizationId: orgA, timestamp: 1000 });
    recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 404, durationMs: 10, organizationId: orgA, timestamp: 1001 });
    recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 200, durationMs: 10, organizationId: orgA, timestamp: 1002 });

    const [stats] = getRouteStats(orgA);

    expect(stats.count).toBe(3);
    expect(stats.errorCount).toBe(1);
  });

  it('5. même route, méthodes différentes (GET vs POST) : deux entrées distinctes', () => {
    recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 200, durationMs: 10, organizationId: orgA, timestamp: 1000 });
    recordRequestSample({ route: '/api/catalog', method: 'POST', statusCode: 201, durationMs: 20, organizationId: orgA, timestamp: 1001 });

    const stats = getRouteStats(orgA);

    expect(stats).toHaveLength(2);
    expect(stats.find((s) => s.method === 'GET')?.count).toBe(1);
    expect(stats.find((s) => s.method === 'POST')?.count).toBe(1);
  });

  it('6. le buffer par route est borné : au-delà du plafond, les échantillons les plus anciens sont évincés', () => {
    for (let i = 0; i < 600; i += 1) {
      recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 200, durationMs: i, organizationId: orgA, timestamp: 1000 + i });
    }

    const [stats] = getRouteStats(orgA);

    expect(stats.count).toBe(500);
    expect(stats.p50).toBeGreaterThanOrEqual(100);
  });

  it('7. resetMetricsStore() vide bien tout', () => {
    recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 200, durationMs: 10, organizationId: orgA, timestamp: 1000 });

    resetMetricsStore();

    expect(getRouteStats(orgA)).toEqual([]);
  });

  it("8. cloisonnement : les échantillons de l'organisation A ne sont jamais visibles dans getRouteStats(orgB)", () => {
    recordRequestSample({ route: '/api/organization/recall', method: 'POST', statusCode: 200, durationMs: 10, organizationId: orgA, timestamp: 1000 });

    expect(getRouteStats(orgB)).toEqual([]);
    expect(getRouteStats(orgA)).toHaveLength(1);
  });

  it('9. organizationId null (requête non authentifiée / route publique) : absente de tout tableau de bord par organisation', () => {
    recordRequestSample({ route: '/health', method: 'GET', statusCode: 200, durationMs: 5, organizationId: null, timestamp: 1000 });

    expect(getRouteStats(orgA)).toEqual([]);
  });

  it("10. le nombre total de clés (org+route+méthode) suivies est borné : au-delà du plafond, la clé la plus ancienne est évincée", () => {
    for (let i = 0; i < 250; i += 1) {
      recordRequestSample({
        route: `/api/route-${i}`,
        method: 'GET',
        statusCode: 200,
        durationMs: 1,
        organizationId: orgA,
        timestamp: 1000 + i,
      });
    }

    const stats = getRouteStats(orgA);

    expect(stats.length).toBeLessThanOrEqual(200);
    expect(stats.find((s) => s.route === '/api/route-0')).toBeUndefined();
    expect(stats.find((s) => s.route === '/api/route-249')).toBeDefined();
  });

  describe('getRequestVolumeSeries', () => {
    const MIN = 60_000;

    it('11. aucune donnée : renvoie windowMinutes buckets vides (count=0, errorCount=0), du plus ancien au plus récent', () => {
      const now = 10 * MIN;
      const series = getRequestVolumeSeries(orgA, { bucketMinutes: 1, windowMinutes: 5, now });

      expect(series).toHaveLength(5);
      expect(series.every((b) => b.count === 0 && b.errorCount === 0)).toBe(true);
      expect(series[0].bucketStartMs).toBeLessThan(series[4].bucketStartMs);
    });

    it('12. un échantillon tombe dans le bon bucket (minute courante = dernier bucket)', () => {
      const now = 10 * MIN;
      recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 200, durationMs: 1, organizationId: orgA, timestamp: now - 500 });

      const series = getRequestVolumeSeries(orgA, { bucketMinutes: 1, windowMinutes: 5, now });

      expect(series[4].count).toBe(1);
      expect(series[0].count).toBe(0);
    });

    it('13. échantillon dans une minute passée : bucket correspondant, pas le dernier', () => {
      const now = 10 * MIN;
      recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 200, durationMs: 1, organizationId: orgA, timestamp: now - 3 * MIN });

      const series = getRequestVolumeSeries(orgA, { bucketMinutes: 1, windowMinutes: 5, now });

      // 3 minutes avant "now" → 3e bucket en partant de la fin (index 4-3=1, "now" étant dans le bucket d'index 4).
      expect(series[1].count).toBe(1);
      expect(series[4].count).toBe(0);
    });

    it("13b. frontière exacte de la fenêtre (timestamp = now - windowMinutes*bucketMs) : exclu, pas de fuite hors fenêtre", () => {
      const now = 10 * MIN;
      recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 200, durationMs: 1, organizationId: orgA, timestamp: now - 5 * MIN });

      const series = getRequestVolumeSeries(orgA, { bucketMinutes: 1, windowMinutes: 5, now });

      expect(series.reduce((sum, b) => sum + b.count, 0)).toBe(0);
    });

    it('13c. timestamp futur (dérive d’horloge, sample postérieur à "now") : exclu, jamais négatif', () => {
      const now = 10 * MIN;
      recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 200, durationMs: 1, organizationId: orgA, timestamp: now + 5000 });

      const series = getRequestVolumeSeries(orgA, { bucketMinutes: 1, windowMinutes: 5, now });

      expect(series.reduce((sum, b) => sum + b.count, 0)).toBe(0);
    });

    it("14. statusCode >= 500 compté dans errorCount du bucket, en plus de count", () => {
      const now = 10 * MIN;
      recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 500, durationMs: 1, organizationId: orgA, timestamp: now - 100 });

      const series = getRequestVolumeSeries(orgA, { bucketMinutes: 1, windowMinutes: 5, now });

      expect(series[4].count).toBe(1);
      expect(series[4].errorCount).toBe(1);
    });

    it('15. échantillon hors fenêtre (trop ancien) : ignoré', () => {
      const now = 10 * MIN;
      recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 200, durationMs: 1, organizationId: orgA, timestamp: now - 60 * MIN });

      const series = getRequestVolumeSeries(orgA, { bucketMinutes: 1, windowMinutes: 5, now });

      expect(series.reduce((sum, b) => sum + b.count, 0)).toBe(0);
    });

    it("16. cloisonnement : la série d'une autre organisation n'apparaît jamais", () => {
      const now = 10 * MIN;
      recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 200, durationMs: 1, organizationId: orgB, timestamp: now - 100 });

      const series = getRequestVolumeSeries(orgA, { bucketMinutes: 1, windowMinutes: 5, now });

      expect(series.reduce((sum, b) => sum + b.count, 0)).toBe(0);
    });

    it("17. agrège toutes les routes/méthodes de l'organisation dans la même série (volume global, pas par route)", () => {
      const now = 10 * MIN;
      recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 200, durationMs: 1, organizationId: orgA, timestamp: now - 100 });
      recordRequestSample({ route: '/api/receipts', method: 'POST', statusCode: 201, durationMs: 1, organizationId: orgA, timestamp: now - 200 });

      const series = getRequestVolumeSeries(orgA, { bucketMinutes: 1, windowMinutes: 5, now });

      expect(series[4].count).toBe(2);
    });
  });
});
