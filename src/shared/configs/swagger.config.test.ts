import { describe, it, expect } from 'vitest';
import swaggerSpec from './swagger.config';

const spec = swaggerSpec as { paths?: Record<string, Record<string, unknown>> };
const paths = spec.paths ?? {};

/**
 * ⚠️ Ce fichier existe pour une raison précise : `/api-docs` a servi un contrat VIDE en production
 * pendant toute la vie du projet, sans que rien ne le signale. Le glob des annotations était
 * relatif au répertoire courant et ne désignait que `src/` — un arbre absent de l'image, qui ne
 * contient que `dist/`. Aucun test ne pouvait le voir : personne n'en écrivait sur la doc.
 */
describe('spécification OpenAPI', () => {
  it("n'est pas vide", () => {
    expect(Object.keys(paths).length).toBeGreaterThan(0);
  });

  /**
   * Les 11 étapes du scénario de démonstration. C'est le parcours qu'un intégrateur suit en
   * premier : si l'une disparaît de la documentation, on veut le savoir avant lui.
   */
  it('documente le parcours de démonstration de bout en bout', () => {
    const expected = [
      ['post', '/api/connectors/imports/products'],
      ['post', '/api/logistics/receipts'],
      ['get', '/api/logistics/batches/{id}/label'],
      ['post', '/api/logistics/batches/{id}/release'],
      ['post', '/api/traceability/transformations'],
      ['post', '/api/logistics/shipments'],
      ['post', '/api/telemetry/ping'],
      ['post', '/api/traceability/batches/{id}/recall'],
      ['get', '/api/public/scan/{id}'],
      ['get', '/api/traceability/events'],
      ['get', '/api/audit/verify'],
    ] as const;

    const missing = expected.filter(([m, p]) => !paths[p]?.[m]);

    expect(missing).toEqual([]);
  });

  it('déclare une section par domaine métier, pas un fourre-tout', () => {
    const sections = new Set<string>();
    for (const methods of Object.values(paths)) {
      for (const def of Object.values(methods)) {
        const tag = (def as { tags?: string[] }).tags?.[0];
        if (tag) sections.add(tag);
      }
    }

    expect(sections).toContain('Logistique');
    expect(sections).toContain('Traçabilité');
    expect(sections).toContain('Connecteurs');
  });
});
