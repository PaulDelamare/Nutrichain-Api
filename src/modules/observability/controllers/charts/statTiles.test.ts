import { describe, it, expect } from 'vitest';
import { renderStatTiles } from './statTiles';

describe('renderStatTiles', () => {
  it('1. affiche les quatre valeurs (requêtes, taux erreur, audit, alertes actives)', () => {
    const html = renderStatTiles({
      totalRequests: 1284,
      errorRate: 0.025,
      auditEntryCount: 53,
      activeAlertCount: 6,
    });

    expect(html).toContain('1,284');
    expect(html).toContain('2.5');
    expect(html).toContain('53');
    expect(html).toContain('6');
  });

  it('2. zéro requête : taux d’erreur à 0 %, pas de division par zéro (NaN)', () => {
    const html = renderStatTiles({
      totalRequests: 0,
      errorRate: 0,
      auditEntryCount: 0,
      activeAlertCount: 0,
    });

    expect(html).not.toContain('NaN');
    expect(html).toContain('0');
  });
});
