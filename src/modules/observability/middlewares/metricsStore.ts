export interface RequestSample {
  route: string;
  method: string;
  statusCode: number;
  durationMs: number;
  /**
   * `null` pour une requête publique (santé, auth) ou non authentifiée. Ces échantillons ne sont
   * jamais restitués par `getRouteStats` : sans organisation, ils ne peuvent être exposés à aucun
   * tableau de bord d'organisation sans devenir une fuite d'information cross-tenant (le volume et
   * la latence d'une route trahissent l'activité d'une AUTRE organisation, ex. un pic sur
   * `/organization/:id/recall`).
   */
  organizationId: string | null;
}

export interface RouteStats {
  route: string;
  method: string;
  count: number;
  errorCount: number;
  p50: number;
  p95: number;
  p99: number;
}

/** Plafond d'échantillons par clé (org+route+méthode) : ring buffer en mémoire, pas de persistance. */
const MAX_SAMPLES_PER_ROUTE = 500;

/**
 * Plafond du nombre de clés distinctes suivies. Sans lui, une requête vers un chemin arbitraire
 * (non authentifiée, non matchée par un routeur) créerait une clé jamais évincée — fuite mémoire
 * lente exploitable par n'importe qui, sans même passer d'authentification.
 */
const MAX_TRACKED_KEYS = 200;

const samplesByKey = new Map<string, RequestSample[]>();

const routeKey = (organizationId: string, method: string, route: string): string =>
  `${organizationId}::${method}::${route}`;

export const recordRequestSample = (sample: RequestSample): void => {
  if (!sample.organizationId) {
    return;
  }

  const key = routeKey(sample.organizationId, sample.method, sample.route);

  if (!samplesByKey.has(key) && samplesByKey.size >= MAX_TRACKED_KEYS) {
    const oldestKey = samplesByKey.keys().next().value;
    if (oldestKey !== undefined) {
      samplesByKey.delete(oldestKey);
    }
  }

  const samples = samplesByKey.get(key) ?? [];
  samples.push(sample);
  if (samples.length > MAX_SAMPLES_PER_ROUTE) {
    samples.shift();
  }
  samplesByKey.set(key, samples);
};

const percentile = (sortedDurations: number[], p: number): number => {
  if (sortedDurations.length === 0) {
    return 0;
  }
  const index = Math.max(0, Math.ceil((p / 100) * sortedDurations.length) - 1);
  return sortedDurations[index];
};

export const getRouteStats = (organizationId: string): RouteStats[] => {
  const prefix = `${organizationId}::`;

  return Array.from(samplesByKey.entries())
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, samples]) => {
      const [, method, ...routeParts] = key.split('::');
      const route = routeParts.join('::');
      const durations = samples.map((s) => s.durationMs).sort((a, b) => a - b);

      return {
        route,
        method,
        count: samples.length,
        errorCount: samples.filter((s) => s.statusCode >= 500).length,
        p50: percentile(durations, 50),
        p95: percentile(durations, 95),
        p99: percentile(durations, 99),
      };
    });
};

export const resetMetricsStore = (): void => {
  samplesByKey.clear();
};
