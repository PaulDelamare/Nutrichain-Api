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

  /**
   * Celle-ci n'est pas exigée au boot (vide = aucune origine additionnelle), donc la boucle
   * ci-dessus ne la couvre pas. Elle mérite quand même sa garde : elle vit dans le bloc que
   * la factorisation en ancre YAML a déplacé, et une résolution de conflit qui reprend « la
   * version d'en face » la fait disparaître sans que rien ne casse — jusqu'à la démo mobile
   * au navigateur, qui repart en 403 « Invalid origin ».
   */
  it('déclare ADDITIONAL_TRUSTED_ORIGINS dans l’environnement partagé', () => {
    expect(compose).toContain('ADDITIONAL_TRUSTED_ORIGINS:');
  });

  /**
   * Cette pile seede des comptes à mot de passe public, dont un admin de plateforme, et ses secrets
   * ont des valeurs de repli publiées ici. Elle ne doit donc jamais tourner en production (#246).
   *
   * L'assertion porte sur la PRÉSENCE de `development`, pas seulement sur l'absence de
   * `production` : l'image, elle, déclare `ENV NODE_ENV=production` (`Dockerfile`). Retirer la
   * ligne de l'ancre partagée ne laisse donc pas la pile « sans valeur » — elle la fait retomber
   * en production, et une assertion en négatif resterait verte en réintroduisant le défaut.
   */
  it('déclare NODE_ENV: development dans l’environnement partagé', () => {
    expect(compose).toContain('NODE_ENV: development');
  });

  it('ne déclare aucun service en production, quel que soit le style YAML', () => {
    expect(compose).not.toMatch(/NODE_ENV:\s*["']?production/);
  });
});
