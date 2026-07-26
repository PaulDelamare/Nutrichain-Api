import { RouteStats } from '../../middlewares/metricsStore';
import { linearScale, niceMax } from './scale';
import { escapeHtml } from '../../../../shared/utils/html/escapeHtml';

export interface LatencyChartResult {
  svg: string;
  shownCount: number;
  hiddenCount: number;
}

/**
 * Plafond de routes affichées. Sans lui, une organisation avec des dizaines de routes distinctes
 * produirait un graphique illisible (et potentiellement énorme, cf. le plafond `MAX_TRACKED_KEYS`
 * de `metricsStore`). Les plus sollicitées (par volume) sont les plus utiles à surveiller.
 */
const MAX_ROUTES = 8;

const BAR_THICKNESS = 14;
const BAR_GAP = 2;
const GROUP_GAP = 12;
const LABEL_WIDTH = 220;
const PLOT_WIDTH = 400;
const HEADER_HEIGHT = 28;
const ROW_HEIGHT = 3 * BAR_THICKNESS + 2 * BAR_GAP;

const SERIES = [
  { key: 'p50', cls: 'chart-lat-p50' },
  { key: 'p95', cls: 'chart-lat-p95' },
  { key: 'p99', cls: 'chart-lat-p99' },
] as const;

/**
 * p50/p95/p99 sont trois paliers de magnitude de la MÊME mesure (pas trois identités
 * distinctes) : rampe séquentielle à une teinte (bleu, clair→foncé), pas une palette
 * catégorielle — cf. skill dataviz, "Compare magnitude → sequential (one hue)".
 */
export const renderLatencyChart = (routeStats: RouteStats[]): LatencyChartResult => {
  if (routeStats.length === 0) {
    return {
      svg: '<p class="chart-empty">Aucune donnée sur cette instance depuis son dernier redémarrage.</p>',
      shownCount: 0,
      hiddenCount: 0,
    };
  }

  const sorted = [...routeStats].sort((a, b) => b.count - a.count);
  const shown = sorted.slice(0, MAX_ROUTES);
  const hiddenCount = sorted.length - shown.length;

  const maxLatency = niceMax(Math.max(...shown.map((s) => s.p99)));
  const scale = linearScale([0, maxLatency], [0, PLOT_WIDTH]);

  const rows = shown
    .map((stat, i) => {
      const groupY = HEADER_HEIGHT + i * (ROW_HEIGHT + GROUP_GAP);
      const label = `<text x="${LABEL_WIDTH - 8}" y="${groupY + ROW_HEIGHT / 2 + 4}" text-anchor="end" class="chart-label">${escapeHtml(stat.method)} ${escapeHtml(stat.route)}</text>`;

      const bars = SERIES.map((series, si) => {
        const value = stat[series.key];
        const y = groupY + si * (BAR_THICKNESS + BAR_GAP);
        const width = Math.max(0, scale(value));
        const title = `${escapeHtml(stat.method)} ${escapeHtml(stat.route)} — ${series.key} ${value.toFixed(1)} ms`;
        return `<rect x="${LABEL_WIDTH}" y="${y}" width="${width.toFixed(1)}" height="${BAR_THICKNESS}" rx="4" class="${series.cls}"><title>${title}</title></rect><text x="${LABEL_WIDTH + width + 6}" y="${y + BAR_THICKNESS - 3}" class="chart-value">${value.toFixed(0)}</text>`;
      }).join('');

      return label + bars;
    })
    .join('');

  const totalHeight = HEADER_HEIGHT + shown.length * (ROW_HEIGHT + GROUP_GAP);
  const svgWidth = LABEL_WIDTH + PLOT_WIDTH + 60;

  const legend = `<g class="chart-legend" transform="translate(${LABEL_WIDTH}, 14)">
    <rect width="10" height="10" rx="2" class="chart-lat-p50"/><text x="14" y="9" class="chart-legend-label">p50</text>
    <rect x="60" width="10" height="10" rx="2" class="chart-lat-p95"/><text x="74" y="9" class="chart-legend-label">p95</text>
    <rect x="120" width="10" height="10" rx="2" class="chart-lat-p99"/><text x="134" y="9" class="chart-legend-label">p99</text>
  </g>`;

  const svg = `<svg viewBox="0 0 ${svgWidth} ${totalHeight}" width="100%" height="${totalHeight}" role="img" aria-label="Latence par route, p50/p95/p99 en millisecondes">${legend}${rows}</svg>`;

  return { svg, shownCount: shown.length, hiddenCount };
};
