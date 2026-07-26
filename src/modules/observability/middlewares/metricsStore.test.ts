import { describe, it, expect, beforeEach } from 'vitest';
import { recordRequestSample, getRouteStats, resetMetricsStore } from './metricsStore';

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
      });
    }

    const [stats] = getRouteStats(orgA);

    expect(stats.count).toBe(100);
    expect(stats.p50).toBe(50);
    expect(stats.p95).toBe(95);
    expect(stats.p99).toBe(99);
  });

  it('4. statusCode >= 500 compté dans errorCount, pas 4xx', () => {
    recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 500, durationMs: 10, organizationId: orgA });
    recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 404, durationMs: 10, organizationId: orgA });
    recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 200, durationMs: 10, organizationId: orgA });

    const [stats] = getRouteStats(orgA);

    expect(stats.count).toBe(3);
    expect(stats.errorCount).toBe(1);
  });

  it('5. même route, méthodes différentes (GET vs POST) : deux entrées distinctes', () => {
    recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 200, durationMs: 10, organizationId: orgA });
    recordRequestSample({ route: '/api/catalog', method: 'POST', statusCode: 201, durationMs: 20, organizationId: orgA });

    const stats = getRouteStats(orgA);

    expect(stats).toHaveLength(2);
    expect(stats.find((s) => s.method === 'GET')?.count).toBe(1);
    expect(stats.find((s) => s.method === 'POST')?.count).toBe(1);
  });

  it('6. le buffer par route est borné : au-delà du plafond, les échantillons les plus anciens sont évincés', () => {
    for (let i = 0; i < 600; i += 1) {
      recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 200, durationMs: i, organizationId: orgA });
    }

    const [stats] = getRouteStats(orgA);

    expect(stats.count).toBe(500);
    expect(stats.p50).toBeGreaterThanOrEqual(100);
  });

  it('7. resetMetricsStore() vide bien tout', () => {
    recordRequestSample({ route: '/api/catalog', method: 'GET', statusCode: 200, durationMs: 10, organizationId: orgA });

    resetMetricsStore();

    expect(getRouteStats(orgA)).toEqual([]);
  });

  it("8. cloisonnement : les échantillons de l'organisation A ne sont jamais visibles dans getRouteStats(orgB)", () => {
    recordRequestSample({ route: '/api/organization/recall', method: 'POST', statusCode: 200, durationMs: 10, organizationId: orgA });

    expect(getRouteStats(orgB)).toEqual([]);
    expect(getRouteStats(orgA)).toHaveLength(1);
  });

  it('9. organizationId null (requête non authentifiée / route publique) : absente de tout tableau de bord par organisation', () => {
    recordRequestSample({ route: '/health', method: 'GET', statusCode: 200, durationMs: 5, organizationId: null });

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
      });
    }

    const stats = getRouteStats(orgA);

    expect(stats.length).toBeLessThanOrEqual(200);
    // La toute première route enregistrée doit avoir été évincée (LRU par insertion).
    expect(stats.find((s) => s.route === '/api/route-0')).toBeUndefined();
    expect(stats.find((s) => s.route === '/api/route-249')).toBeDefined();
  });
});
