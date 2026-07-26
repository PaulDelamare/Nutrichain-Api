import { describe, it, expect } from 'vitest';
import { renderDashboardHtml } from './renderDashboardHtml';
import { DashboardMetrics } from '../services/observability.service';

const buildMetrics = (overrides: Partial<DashboardMetrics> = {}): DashboardMetrics => ({
  requestLatency: [],
  requestVolumeSeries: [],
  auditEntryCount: 0,
  alerts: [],
  kpis: { totalRequests: 0, errorRate: 0, auditEntryCount: 0, activeAlertCount: 0 },
  windowHours: 24,
  ...overrides,
});

describe('renderDashboardHtml', () => {
  it('1. aucune donnée : rend un HTML valide sans crash', () => {
    const html = renderDashboardHtml(buildMetrics());

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Aucune donnée');
  });

  it('2. affiche les tuiles KPI', () => {
    const html = renderDashboardHtml(
      buildMetrics({ kpis: { totalRequests: 42, errorRate: 0.1, auditEntryCount: 5, activeAlertCount: 2 } })
    );

    expect(html).toContain('42');
    expect(html).toContain('10.0%');
  });

  it('3. affiche le graphique de latence par route (SVG réel)', () => {
    const html = renderDashboardHtml(
      buildMetrics({
        requestLatency: [
          { route: '/api/catalog', method: 'GET', count: 10, errorCount: 0, p50: 5, p95: 12, p99: 20 },
        ],
      })
    );

    expect(html).toContain('<svg');
    expect(html).toContain('/api/catalog');
  });

  it("4. échappe un nom de route contenant du HTML (défense en profondeur XSS)", () => {
    const html = renderDashboardHtml(
      buildMetrics({
        requestLatency: [
          {
            route: '/api/<script>alert(1)</script>',
            method: 'GET',
            count: 1,
            errorCount: 0,
            p50: 1,
            p95: 1,
            p99: 1,
          },
        ],
      })
    );

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it("5. affiche le graphique d'alertes par type/statut", () => {
    const html = renderDashboardHtml(
      buildMetrics({ alerts: [{ type: 'TEMP_EXCURSION', statut: 'ACTIVE', count: 3 }] })
    );

    expect(html).toContain('TEMP_EXCURSION');
    expect(html).toContain('chart-alert-active');
  });

  it('6. affiche le graphique de volume de requêtes dans le temps', () => {
    const html = renderDashboardHtml(
      buildMetrics({
        requestVolumeSeries: [{ bucketStartMs: 0, count: 5, errorCount: 1 }],
      })
    );

    expect(html).toContain('chart-vol-ok');
  });

  it('7. supporte le mode sombre (media query prefers-color-scheme + attribut data-theme)', () => {
    const html = renderDashboardHtml(buildMetrics());

    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain('data-theme="dark"');
  });
});
