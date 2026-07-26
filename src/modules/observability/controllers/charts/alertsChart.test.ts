import { describe, it, expect } from 'vitest';
import { renderAlertsChart } from './alertsChart';
import { AlertBreakdown } from '../../services/observability.service';

describe('renderAlertsChart', () => {
  it('1. aucune alerte : pas de SVG, message "Aucune donnée"', () => {
    const { svg } = renderAlertsChart([]);
    expect(svg).toContain('Aucune donnée');
    expect(svg).not.toContain('<svg');
  });

  it('2. une alerte ACTIVE : barre en couleur critique, type et statut affichés', () => {
    const alerts: AlertBreakdown[] = [{ type: 'TEMP_EXCURSION', statut: 'ACTIVE', count: 3 }];
    const { svg } = renderAlertsChart(alerts);

    expect(svg).toContain('<svg');
    expect(svg).toContain('TEMP_EXCURSION');
    expect(svg).toContain('chart-alert-active');
  });

  it('3. une alerte RESOLVED : barre en couleur "bonne"', () => {
    const alerts: AlertBreakdown[] = [{ type: 'PRODUCT_RECALL', statut: 'RESOLVED', count: 1 }];
    const { svg } = renderAlertsChart(alerts);

    expect(svg).toContain('chart-alert-resolved');
  });

  it("4. échappe un type d'alerte contenant du HTML (XSS)", () => {
    const alerts: AlertBreakdown[] = [{ type: '<script>alert(1)</script>', statut: 'ACTIVE', count: 1 }];
    const { svg } = renderAlertsChart(alerts);

    expect(svg).not.toContain('<script>alert(1)</script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('5. un statut inconnu (ni ACTIVE ni RESOLVED) : ne crash pas, rendu en couleur neutre', () => {
    const alerts: AlertBreakdown[] = [{ type: 'CUSTOM', statut: 'INVESTIGATING', count: 1 }];
    expect(() => renderAlertsChart(alerts)).not.toThrow();
  });
});
