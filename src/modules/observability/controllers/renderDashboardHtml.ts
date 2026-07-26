import { DashboardMetrics } from '../services/observability.service';
import { escapeHtml } from '../../../shared/utils/html/escapeHtml';
import { renderLatencyChart } from './charts/latencyChart';
import { renderVolumeChart } from './charts/volumeChart';
import { renderAlertsChart } from './charts/alertsChart';
import { renderStatTiles } from './charts/statTiles';

const renderLatencyCaption = (hiddenCount: number): string =>
  hiddenCount > 0
    ? `<p class="chart-caption">${hiddenCount} route(s) supplémentaire(s) non affichée(s) (triées par volume, les 8 plus sollicitées sont montrées).</p>`
    : '';

/**
 * Rendu HTML pur, sans dépendance à Express — testable indépendamment du controller. Palette et
 * spécifications de marque issues du skill dataviz du dépôt : rampe séquentielle pour une magnitude
 * ordonnée (p50/p95/p99), couleurs de statut pour un état (réussite/erreur, alerte active/résolue).
 */
export const renderDashboardHtml = (metrics: DashboardMetrics): string => {
  const latency = renderLatencyChart(metrics.requestLatency);
  const volume = renderVolumeChart(metrics.requestVolumeSeries);
  const alertsChart = renderAlertsChart(metrics.alerts);
  const statTiles = renderStatTiles(metrics.kpis);

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Observabilité — NutriChain</title>
  <style>
    .viz-root {
      color-scheme: light;
      --surface-1:      #fcfcfb;
      --surface-2:      #f9f9f7;
      --text-primary:   #0b0b0b;
      --text-secondary: #52514e;
      --text-muted:     #898781;
      --grid:           #e1e0d9;
      --axis:           #c3c2b7;
      --border:         rgba(11,11,11,0.10);
      --lat-p50:        #5598e7;
      --lat-p95:        #256abf;
      --lat-p99:        #104281;
      --status-good:    #0ca30c;
      --status-critical:#d03b3b;
      --status-neutral: #898781;
    }
    @media (prefers-color-scheme: dark) {
      :root:where(:not([data-theme="light"])) .viz-root {
        color-scheme: dark;
        --surface-1:      #1a1a19;
        --surface-2:      #0d0d0d;
        --text-primary:   #ffffff;
        --text-secondary: #c3c2b7;
        --text-muted:     #898781;
        --grid:           #2c2c2a;
        --axis:           #383835;
        --border:         rgba(255,255,255,0.10);
        --lat-p50:        #6da7ec;
        --lat-p95:        #3987e5;
        --lat-p99:        #184f95;
        --status-good:    #0ca30c;
        --status-critical:#e66767;
        --status-neutral: #898781;
      }
    }
    :root[data-theme="dark"] .viz-root {
      color-scheme: dark;
      --surface-1:      #1a1a19;
      --surface-2:      #0d0d0d;
      --text-primary:   #ffffff;
      --text-secondary: #c3c2b7;
      --text-muted:     #898781;
      --grid:           #2c2c2a;
      --axis:           #383835;
      --border:         rgba(255,255,255,0.10);
      --lat-p50:        #6da7ec;
      --lat-p95:        #3987e5;
      --lat-p99:        #184f95;
      --status-good:    #0ca30c;
      --status-critical:#e66767;
      --status-neutral: #898781;
    }

    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    /* color/background vivent sur .viz-root, pas sur body : les custom properties ci-dessus
       sont déclarées sur .viz-root, un DESCENDANT de body — body ne peut pas les lire (les
       variables CSS ne remontent jamais l'arbre). Les poser sur body produisait un var()
       invalide au calcul, donc un texte noir par défaut sur fond sombre : illisible en dark
       mode, découvert à l'écran, pas dans les tests. */
    .viz-root {
      padding: 2rem;
      min-height: 100vh;
      background: var(--surface-2);
      color: var(--text-primary);
    }
    h1 { font-size: 1.375rem; margin: 0 0 1.5rem; }
    h2 { font-size: 1rem; margin: 0 0 0.75rem; color: var(--text-primary); }
    .card {
      background: var(--surface-1);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
      margin-bottom: 1.5rem;
    }
    .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 1.5rem; }

    .stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; }
    .stat-tile {
      background: var(--surface-1);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .stat-label { font-size: 0.8rem; color: var(--text-secondary); }
    .stat-value { font-size: 1.75rem; font-weight: 600; color: var(--text-primary); }

    .chart-label { font-size: 11px; fill: var(--text-secondary); }
    .chart-value { font-size: 11px; fill: var(--text-secondary); font-variant-numeric: tabular-nums; }
    .chart-legend-label { font-size: 11px; fill: var(--text-secondary); }
    .chart-axis { stroke: var(--axis); stroke-width: 1; }
    .chart-empty { color: var(--text-muted); font-size: 0.9rem; }
    .chart-caption { color: var(--text-muted); font-size: 0.8rem; margin-top: 0.5rem; }

    .chart-lat-p50 { fill: var(--lat-p50); }
    .chart-lat-p95 { fill: var(--lat-p95); }
    .chart-lat-p99 { fill: var(--lat-p99); }
    .chart-vol-ok { fill: var(--status-good); }
    .chart-vol-error { fill: var(--status-critical); }
    .chart-alert-active { fill: var(--status-critical); }
    .chart-alert-resolved { fill: var(--status-good); }
    .chart-alert-neutral { fill: var(--status-neutral); }

    table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
    th, td { border: 1px solid var(--border); padding: 0.5rem; text-align: left; }
    th { background: var(--surface-2); color: var(--text-secondary); font-weight: 600; }
    td { font-variant-numeric: tabular-nums; }
  </style>
</head>
<body>
  <div class="viz-root">
    <h1>Observabilité — organisation active</h1>

    <div class="card">${statTiles}</div>

    <div class="grid-2">
      <div class="card">
        <h2>Latence par route — p50 / p95 / p99 (ms)</h2>
        ${latency.svg}
        ${renderLatencyCaption(latency.hiddenCount)}
      </div>
      <div class="card">
        <h2>Volume de requêtes — 30 dernières minutes</h2>
        ${volume.svg}
      </div>
    </div>

    <div class="card">
      <h2>Alertes par type et statut — ${metrics.windowHours} dernières heures</h2>
      ${alertsChart.svg}
    </div>

    <div class="card">
      <h2>Détail — latence par route</h2>
      <table>
        <thead>
          <tr><th>Méthode</th><th>Route</th><th>Requêtes</th><th>Erreurs 5xx</th><th>p50 (ms)</th><th>p95 (ms)</th><th>p99 (ms)</th></tr>
        </thead>
        <tbody>${renderLatencyTableRows(metrics)}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>Détail — alertes</h2>
      <table>
        <thead><tr><th>Type</th><th>Statut</th><th>Nombre</th></tr></thead>
        <tbody>${renderAlertsTableRows(metrics)}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
};

const renderLatencyTableRows = (metrics: DashboardMetrics): string => {
  if (metrics.requestLatency.length === 0) {
    return '<tr><td colspan="7">Aucune donnée sur cette instance depuis son dernier redémarrage.</td></tr>';
  }

  return metrics.requestLatency
    .map(
      (stat) => `<tr>
        <td>${escapeHtml(stat.method)}</td>
        <td>${escapeHtml(stat.route)}</td>
        <td>${stat.count}</td>
        <td>${stat.errorCount}</td>
        <td>${stat.p50.toFixed(1)}</td>
        <td>${stat.p95.toFixed(1)}</td>
        <td>${stat.p99.toFixed(1)}</td>
      </tr>`
    )
    .join('');
};

const renderAlertsTableRows = (metrics: DashboardMetrics): string => {
  if (metrics.alerts.length === 0) {
    return `<tr><td colspan="3">Aucune donnée sur les ${metrics.windowHours} dernières heures.</td></tr>`;
  }

  return metrics.alerts
    .map(
      (alert) => `<tr>
        <td>${escapeHtml(alert.type)}</td>
        <td>${escapeHtml(alert.statut)}</td>
        <td>${alert.count}</td>
      </tr>`
    )
    .join('');
};
