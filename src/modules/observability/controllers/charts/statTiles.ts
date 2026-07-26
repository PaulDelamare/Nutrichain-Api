import { DashboardKpis } from '../../services/observability.service';

const formatInt = (n: number): string => n.toLocaleString('en-US');

const tile = (label: string, value: string): string =>
  `<div class="stat-tile"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`;

export const renderStatTiles = (kpis: DashboardKpis): string => {
  const errorRatePct = (kpis.errorRate * 100).toFixed(1);

  return `<div class="stat-row">
    ${tile('Requêtes (ring buffer)', formatInt(kpis.totalRequests))}
    ${tile('Taux d’erreur 5xx', `${errorRatePct}%`)}
    ${tile("Entrées d'audit (24h)", formatInt(kpis.auditEntryCount))}
    ${tile('Alertes actives', formatInt(kpis.activeAlertCount))}
  </div>`;
};
