import { describe, it, expect } from 'vitest';
import { renderLatencyChart } from './latencyChart';
import { RouteStats } from '../../middlewares/metricsStore';

const buildStat = (overrides: Partial<RouteStats> = {}): RouteStats => ({
  route: '/api/catalog',
  method: 'GET',
  count: 10,
  errorCount: 0,
  p50: 5,
  p95: 12,
  p99: 20,
  ...overrides,
});

describe('renderLatencyChart', () => {
  it('1. aucune route : pas de SVG, message "Aucune donnée"', () => {
    const { svg, shownCount, hiddenCount } = renderLatencyChart([]);
    expect(svg).toContain('Aucune donnée');
    expect(svg).not.toContain('<svg');
    expect(shownCount).toBe(0);
    expect(hiddenCount).toBe(0);
  });

  it('2. une route : trois barres (p50/p95/p99), route et méthode affichées', () => {
    const { svg, shownCount, hiddenCount } = renderLatencyChart([buildStat()]);

    expect(svg).toContain('<svg');
    expect(svg).toContain('/api/catalog');
    expect(svg).toContain('GET');
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(shownCount).toBe(1);
    expect(hiddenCount).toBe(0);
  });

  it("3. échappe un nom de route contenant du HTML (XSS)", () => {
    const { svg } = renderLatencyChart([buildStat({ route: '/api/<script>alert(1)</script>' })]);

    expect(svg).not.toContain('<script>alert(1)</script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('4. plus de 8 routes : seules les 8 plus sollicitées (par count) sont affichées, le reste compté dans hiddenCount', () => {
    const stats = Array.from({ length: 12 }, (_, i) =>
      buildStat({ route: `/api/route-${i}`, count: i })
    );

    const { svg, shownCount, hiddenCount } = renderLatencyChart(stats);

    expect(shownCount).toBe(8);
    expect(hiddenCount).toBe(4);
    // La route la moins sollicitée (count=0) ne doit pas apparaître.
    expect(svg).not.toContain('/api/route-0<');
    expect(svg).toContain('/api/route-11');
  });

  it('5. p99 le plus élevé détermine le plafond de l’échelle : aucune barre ne dépasse la largeur du graphique', () => {
    const { svg } = renderLatencyChart([buildStat({ p50: 10, p95: 50, p99: 95 })]);

    const widths = [...svg.matchAll(/width="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(widths.every((w) => w <= 400)).toBe(true);
  });
});
