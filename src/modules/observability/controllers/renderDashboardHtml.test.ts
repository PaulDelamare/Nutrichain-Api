import { describe, it, expect } from 'vitest';
import { renderDashboardHtml } from './renderDashboardHtml';
import { DashboardMetrics } from '../services/observability.service';

const buildMetrics = (overrides: Partial<DashboardMetrics> = {}): DashboardMetrics => ({
  requestLatency: [],
  auditEntryCount: 0,
  alerts: [],
  windowHours: 24,
  ...overrides,
});

describe('renderDashboardHtml', () => {
  it('1. aucune donnée : rend un HTML valide sans crash, mentionne "Aucune donnée"', () => {
    const html = renderDashboardHtml(buildMetrics());

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Aucune donnée');
  });

  it('2. affiche les lignes de latence par route avec p50/p95/p99', () => {
    const html = renderDashboardHtml(
      buildMetrics({
        requestLatency: [
          { route: '/api/catalog', method: 'GET', count: 10, errorCount: 0, p50: 5, p95: 12, p99: 20 },
        ],
      })
    );

    expect(html).toContain('/api/catalog');
    expect(html).toContain('GET');
    expect(html).toContain('20');
  });

  it("3. échappe un nom de route contenant du HTML (défense en profondeur XSS)", () => {
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

  it("4. affiche le total d'audit et les alertes par type/statut", () => {
    const html = renderDashboardHtml(
      buildMetrics({
        auditEntryCount: 42,
        alerts: [{ type: 'TEMP_EXCURSION', statut: 'ACTIVE', count: 3 }],
      })
    );

    expect(html).toContain('42');
    expect(html).toContain('TEMP_EXCURSION');
    expect(html).toContain('ACTIVE');
  });
});
