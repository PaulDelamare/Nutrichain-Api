import { RequestVolumeBucket } from '../../middlewares/metricsStore';
import { linearScale, niceMax } from './scale';

export interface VolumeChartResult {
  svg: string;
  totalRequests: number;
  totalErrors: number;
}

const BAR_WIDTH = 12;
const BAR_GAP = 4;
const PLOT_HEIGHT = 160;
const HEADER_HEIGHT = 20;
const AXIS_LABEL_WIDTH = 36;

/**
 * Réussite/échec est un état (bon/critique), pas une identité de série : couleurs de statut, pas
 * catégorielles — cf. skill dataviz, palette de statut réservée aux états.
 */
export const renderVolumeChart = (buckets: RequestVolumeBucket[]): VolumeChartResult => {
  const totalRequests = buckets.reduce((sum, b) => sum + b.count, 0);
  const totalErrors = buckets.reduce((sum, b) => sum + b.errorCount, 0);

  const maxCount = niceMax(Math.max(0, ...buckets.map((b) => b.count)));
  const scale = linearScale([0, maxCount], [0, PLOT_HEIGHT]);
  const baselineY = HEADER_HEIGHT + PLOT_HEIGHT;

  const bars = buckets
    .map((bucket, i) => {
      const x = AXIS_LABEL_WIDTH + i * (BAR_WIDTH + BAR_GAP);
      const okCount = bucket.count - bucket.errorCount;
      const okHeight = scale(okCount);
      const errorHeight = scale(bucket.errorCount);

      const okRect =
        okHeight > 0
          ? `<rect x="${x}" y="${(baselineY - okHeight).toFixed(1)}" width="${BAR_WIDTH}" height="${okHeight.toFixed(1)}" rx="3" class="chart-vol-ok"><title>${new Date(bucket.bucketStartMs).toLocaleTimeString('fr-FR')} — ${okCount} requête(s) OK</title></rect>`
          : '';

      const errorRect =
        errorHeight > 0
          ? `<rect x="${x}" y="${(baselineY - okHeight - errorHeight).toFixed(1)}" width="${BAR_WIDTH}" height="${errorHeight.toFixed(1)}" rx="3" class="chart-vol-error"><title>${new Date(bucket.bucketStartMs).toLocaleTimeString('fr-FR')} — ${bucket.errorCount} erreur(s) 5xx</title></rect>`
          : '';

      return okRect + errorRect;
    })
    .join('');

  const svgWidth = AXIS_LABEL_WIDTH + Math.max(1, buckets.length) * (BAR_WIDTH + BAR_GAP) + 10;
  const totalHeight = HEADER_HEIGHT + PLOT_HEIGHT + 10;
  const baseline = `<line x1="${AXIS_LABEL_WIDTH}" y1="${baselineY}" x2="${svgWidth}" y2="${baselineY}" class="chart-axis"/>`;

  const legend = `<g class="chart-legend" transform="translate(${AXIS_LABEL_WIDTH}, 12)">
    <rect width="10" height="10" rx="2" class="chart-vol-ok"/><text x="14" y="9" class="chart-legend-label">Réussies</text>
    <rect x="80" width="10" height="10" rx="2" class="chart-vol-error"/><text x="94" y="9" class="chart-legend-label">Erreurs 5xx</text>
  </g>`;

  const svg = `<svg viewBox="0 0 ${svgWidth} ${totalHeight}" width="100%" height="${totalHeight}" role="img" aria-label="Volume de requêtes dans le temps, réussies et en erreur">${legend}${baseline}${bars}</svg>`;

  return { svg, totalRequests, totalErrors };
};
