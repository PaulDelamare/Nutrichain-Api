import { AlertBreakdown } from '../../services/observability.service';
import { linearScale, niceMax } from './scale';
import { escapeHtml } from '../../../../shared/utils/html/escapeHtml';

export interface AlertsChartResult {
  svg: string;
}

const BAR_THICKNESS = 16;
const ROW_GAP = 6;
const LABEL_WIDTH = 200;
const PLOT_WIDTH = 300;
const HEADER_HEIGHT = 24;

/** Le statut d'une alerte est un ÉTAT (en cours / traité), pas une identité : couleurs de statut. */
const statutClass = (statut: string): string => {
  if (statut === 'ACTIVE') {
    return 'chart-alert-active';
  }
  if (statut === 'RESOLVED') {
    return 'chart-alert-resolved';
  }
  return 'chart-alert-neutral';
};

export const renderAlertsChart = (alerts: AlertBreakdown[]): AlertsChartResult => {
  if (alerts.length === 0) {
    return { svg: `<p class="chart-empty">Aucune donnée sur les dernières heures.</p>` };
  }

  const maxCount = niceMax(Math.max(...alerts.map((a) => a.count)));
  const scale = linearScale([0, maxCount], [0, PLOT_WIDTH]);
  const rowHeight = BAR_THICKNESS + ROW_GAP;

  const rows = alerts
    .map((alert, i) => {
      const y = HEADER_HEIGHT + i * rowHeight;
      const width = Math.max(0, scale(alert.count));
      const cls = statutClass(alert.statut);
      const label = `<text x="${LABEL_WIDTH - 8}" y="${y + BAR_THICKNESS - 3}" text-anchor="end" class="chart-label">${escapeHtml(alert.type)}</text>`;
      const title = `${escapeHtml(alert.type)} — ${escapeHtml(alert.statut)} : ${alert.count}`;
      const bar = `<rect x="${LABEL_WIDTH}" y="${y}" width="${width.toFixed(1)}" height="${BAR_THICKNESS}" rx="4" class="${cls}"><title>${title}</title></rect><text x="${LABEL_WIDTH + width + 6}" y="${y + BAR_THICKNESS - 3}" class="chart-value">${alert.count}</text>`;
      return label + bar;
    })
    .join('');

  const totalHeight = HEADER_HEIGHT + alerts.length * rowHeight;
  const svgWidth = LABEL_WIDTH + PLOT_WIDTH + 60;

  const legend = `<g class="chart-legend" transform="translate(${LABEL_WIDTH}, 14)">
    <rect width="10" height="10" rx="2" class="chart-alert-active"/><text x="14" y="9" class="chart-legend-label">Active</text>
    <rect x="80" width="10" height="10" rx="2" class="chart-alert-resolved"/><text x="94" y="9" class="chart-legend-label">Résolue</text>
  </g>`;

  const svg = `<svg viewBox="0 0 ${svgWidth} ${totalHeight}" width="100%" height="${totalHeight}" role="img" aria-label="Alertes par type et statut">${legend}${rows}</svg>`;

  return { svg };
};
