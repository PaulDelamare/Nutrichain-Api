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

  /**
   * #248 — Les trois secrets avaient une valeur de repli littérale, versionnée ici. `docker compose
   * up` démarrait donc, sans rien dire, avec des secrets que quiconque a lu le dépôt connaît :
   * `BETTER_AUTH_SECRET` signe les cookies de session (donc des sessions forgeables),
   * `IOT_API_KEY` ouvre l'ingestion capteurs (donc le déclenchement ou l'étouffement d'alertes
   * froid), `API_KEY` ouvre les routes qui n'exigent que la clé.
   *
   * `:?` fait échouer le démarrage avec un message clair au lieu de réussir avec un secret public.
   * Les valeurs de démonstration vivent désormais dans `.env.demo`, où elles sont un choix explicite
   * et non un défaut invisible.
   */
  describe('les secrets n’ont aucune valeur de repli (#248)', () => {
    const SECRETS = ['BETTER_AUTH_SECRET', 'API_KEY', 'IOT_API_KEY'];

    for (const secret of SECRETS) {
      it(`${secret} est exigé, pas replié sur une valeur publiée`, () => {
        // `:-` = « prends cette valeur si la variable est absente » ; `:?` = « échoue si absente ».
        expect(compose).not.toMatch(new RegExp(`\\$\\{${secret}:-`));
        expect(compose).toMatch(new RegExp(`\\$\\{${secret}:\\?`));
      });

      /**
       * Le message de `:?` contient de la ponctuation, et un `: ` non protégé transforme la ligne
       * en mapping imbriqué : `docker compose config` sort alors sur « mapping values are not
       * allowed in this context » — la pile ne démarre plus du tout. C'est arrivé en écrivant ce
       * correctif, et aucune assertion textuelle ne l'avait vu. Les guillemets referment le cas.
       */
      it(`${secret} garde sa valeur entre guillemets, pour que le message ne casse pas le YAML`, () => {
        expect(compose).toMatch(new RegExp(`${secret}: "\\$\\{${secret}:\\?[^"]*}"`));
      });
    }
  });

  /**
   * Le fichier de démonstration doit rester utilisable en une commande : s'il cesse de fournir un
   * secret que le compose exige, `docker compose --env-file .env.demo up` échoue — et c'est la
   * première commande que lit un jury.
   */
  describe('.env.demo couvre ce que le compose exige (#248)', () => {
    const demo = readFileSync(join(process.cwd(), '.env.demo'), 'utf8');

    for (const secret of ['BETTER_AUTH_SECRET', 'API_KEY', 'IOT_API_KEY']) {
      it(`fournit ${secret}`, () => {
        expect(demo).toMatch(new RegExp(`^${secret}=.+`, 'm'));
      });
    }

    it('déclare explicitement qu’il s’agit de secrets de démonstration', () => {
      expect(demo).toMatch(/^ALLOW_DEMO_SECRETS=1$/m);
    });
  });
});
