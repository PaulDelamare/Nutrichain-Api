import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { REQUIRED_ENV_VARS } from './env.validator';

/**
 * `assertEnv()` tue le processus au démarrage si une variable requise manque. Le jour où l'on en
 * ajoute une sans la déclarer dans `docker-compose.yml`, `docker compose up` — la première commande
 * du README — part en boucle de redémarrage, et rien dans la CI ne le voit (issue #101 : c'est
 * arrivé avec `IOT_API_KEY`).
 *
 * Ce test lit le compose comme un fichier texte : il n'a pas besoin de Docker pour rendre la
 * divergence visible.
 */
describe('docker-compose fournit tout ce que le boot exige', () => {
  const compose = readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf8');

  for (const variable of REQUIRED_ENV_VARS) {
    it(`déclare ${variable} au service api`, () => {
      expect(compose).toContain(`${variable}:`);
    });
  }
});
