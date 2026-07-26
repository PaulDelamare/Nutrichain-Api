import { describe, it, expect } from 'vitest';
import { renderVolumeChart } from './volumeChart';
import { RequestVolumeBucket } from '../../middlewares/metricsStore';

const buildBuckets = (values: Array<{ count: number; errorCount: number }>): RequestVolumeBucket[] =>
  values.map((v, i) => ({ bucketStartMs: i * 60_000, count: v.count, errorCount: v.errorCount }));

describe('renderVolumeChart', () => {
  it('1. tous les buckets vides : SVG rendu quand même (axe à zéro), pas de crash', () => {
    const { svg } = renderVolumeChart(buildBuckets([{ count: 0, errorCount: 0 }, { count: 0, errorCount: 0 }]));
    expect(svg).toContain('<svg');
  });

  it('2. une colonne avec succès + erreurs : deux segments empilés (bon statut / statut critique)', () => {
    const { svg } = renderVolumeChart(buildBuckets([{ count: 10, errorCount: 3 }]));

    expect(svg).toContain('chart-vol-ok');
    expect(svg).toContain('chart-vol-error');
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('3. errorCount = 0 : aucune barre de données critique (seule la légende porte la classe)', () => {
    const { svg } = renderVolumeChart(buildBuckets([{ count: 10, errorCount: 0 }]));

    // La légende affiche toujours les deux catégories (1 occurrence) ; aucune barre de DONNÉES
    // en plus (pas de rect de hauteur 0 inutile).
    expect((svg.match(/class="chart-vol-error"/g) ?? []).length).toBe(1);
  });

  it('4. calcule le total de requêtes et le total d’erreurs sur toute la fenêtre', () => {
    const { totalRequests, totalErrors } = renderVolumeChart(
      buildBuckets([
        { count: 10, errorCount: 1 },
        { count: 20, errorCount: 2 },
      ])
    );

    expect(totalRequests).toBe(30);
    expect(totalErrors).toBe(3);
  });

  it('5. aucun bucket du tout : totaux à 0, pas de crash', () => {
    const { svg, totalRequests, totalErrors } = renderVolumeChart([]);
    expect(svg).toContain('<svg');
    expect(totalRequests).toBe(0);
    expect(totalErrors).toBe(0);
  });
});
