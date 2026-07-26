import { DashboardMetrics } from '../services/observability.service';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderLatencyRows = (metrics: DashboardMetrics): string => {
  if (metrics.requestLatency.length === 0) {
    return '<tr><td colspan="6">Aucune donnée sur cette instance depuis son dernier redémarrage.</td></tr>';
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

const renderAlertRows = (metrics: DashboardMetrics): string => {
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

/** Rendu HTML pur, sans dépendance à Express — testable indépendamment du controller. */
export const renderDashboardHtml = (metrics: DashboardMetrics): string => `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>Observabilité — NutriChain</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
    h1 { font-size: 1.25rem; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 2rem; }
    th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; font-size: 0.9rem; }
    th { background: #f5f5f5; }
  </style>
</head>
<body>
  <h1>Observabilité — organisation active</h1>

  <h2>Latence par route (ring buffer en mémoire, depuis le dernier redémarrage)</h2>
  <table>
    <thead>
      <tr><th>Méthode</th><th>Route</th><th>Requêtes</th><th>Erreurs 5xx</th><th>p50 (ms)</th><th>p95 (ms)</th><th>p99 (ms)</th></tr>
    </thead>
    <tbody>${renderLatencyRows(metrics)}</tbody>
  </table>

  <h2>Journal d'audit — ${metrics.windowHours} dernières heures</h2>
  <p>${metrics.auditEntryCount} entrée(s).</p>

  <h2>Alertes — ${metrics.windowHours} dernières heures</h2>
  <table>
    <thead><tr><th>Type</th><th>Statut</th><th>Nombre</th></tr></thead>
    <tbody>${renderAlertRows(metrics)}</tbody>
  </table>
</body>
</html>`;
