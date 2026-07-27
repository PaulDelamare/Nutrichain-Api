import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { redactUrl, PARAMS_SENSIBLES } from './redactUrl';

describe('redactUrl (#253)', () => {
  it('masque le jeton d’invitation', () => {
    const masquee = redactUrl('/api/identity/invitations/33333333-3333-4333-8333-333333333333/preview');

    expect(masquee).not.toContain('33333333-3333-4333-8333-333333333333');
    expect(masquee).toBe('/api/identity/invitations/[masqué]/preview');
  });

  it('masque aussi quand une chaîne de requête suit', () => {
    const masquee = redactUrl('/api/identity/invitations/abc-123/preview?lang=fr');

    expect(masquee).not.toContain('abc-123');
    expect(masquee).toContain('?lang=fr');
  });

  it('laisse intactes les URL qui ne portent aucun secret', () => {
    // Une rédaction trop large rendrait les journaux inutilisables pour le diagnostic — c'est
    // précisément ce qu'on ne veut pas en échange de la confidentialité.
    const urls = [
      '/api/me',
      '/api/traceability/batches/34fd1c35-1157-4930-b6e9-c1014bf011e6/genealogy',
      '/api/logistics/receipts?page=2&limit=20',
      '/api/health',
    ];

    for (const url of urls) {
      expect(redactUrl(url)).toBe(url);
    }
  });

  /**
   * La garde qui compte. `SEGMENTS_SENSIBLES` est une liste nommée : elle ne protège que ce qu'on y
   * déclare. Ce test relit les fichiers de routes et échoue si une route expose un paramètre de
   * chemin qui ressemble à un secret sans que `redactUrl` le masque — sinon la prochaine route
   * ajoutée referait fuiter son jeton, en silence, dans deux fichiers de journaux et vers le SIEM.
   */
  it('couvre tout paramètre de chemin qui ressemble à un secret', () => {
    const racine = path.join(process.cwd(), 'src', 'modules');
    const fichiersRoutes: string[] = [];

    const parcourir = (dossier: string) => {
      for (const entree of readdirSync(dossier)) {
        const chemin = path.join(dossier, entree);
        if (statSync(chemin).isDirectory()) parcourir(chemin);
        else if (chemin.endsWith('.routes.ts') && !chemin.endsWith('.test.ts')) {
          fichiersRoutes.push(chemin);
        }
      }
    };
    parcourir(racine);
    expect(fichiersRoutes.length).toBeGreaterThan(0);

    const nonCouverts: string[] = [];

    for (const fichier of fichiersRoutes) {
      const source = readFileSync(fichier, 'utf8');
      // `router.get('/chemin/:token/suite', …)` → on récupère le chemin déclaré.
      for (const m of source.matchAll(/router\.\w+\(\s*['"`]([^'"`]+)['"`]/g)) {
        const chemin = m[1];
        const segments = chemin.split('/').filter((s) => s.startsWith(':'));
        if (!segments.some((s) => PARAMS_SENSIBLES.test(s))) continue;

        // Le chemin déclare un secret : `redactUrl` doit le masquer. On substitue une valeur
        // reconnaissable à la place du paramètre et on vérifie qu'elle disparaît.
        const sentinelle = 'VALEUR-SECRETE-SENTINELLE';
        const urlConcrete = chemin
          .split('/')
          .map((s) => (s.startsWith(':') ? (PARAMS_SENSIBLES.test(s) ? sentinelle : 'x') : s))
          .join('/');

        if (redactUrl(`/api${urlConcrete}`).includes(sentinelle)) {
          nonCouverts.push(`${path.relative(process.cwd(), fichier)} → ${chemin}`);
        }
      }
    }

    expect(nonCouverts).toEqual([]);
  });
});
