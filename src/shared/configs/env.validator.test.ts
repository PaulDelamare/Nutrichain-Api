import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { assertEnv, REQUIRED_ENV_VARS } from './env.validator';

describe('assertEnv (Fail Fast au boot)', () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    for (const key of REQUIRED_ENV_VARS) {
      process.env[key] = 'placeholder';
    }
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it('ne doit pas throw quand toutes les variables requises sont définies', () => {
    expect(() => assertEnv()).not.toThrow();
  });

  it('doit throw avec le nom de la variable manquante', () => {
    delete process.env.DATABASE_URL;
    expect(() => assertEnv()).toThrow(/DATABASE_URL/);
  });

  it('doit lister toutes les variables manquantes dans un seul message', () => {
    delete process.env.DATABASE_URL;
    delete process.env.API_KEY;
    expect(() => assertEnv()).toThrow(/DATABASE_URL.*API_KEY|API_KEY.*DATABASE_URL/);
  });

  it('doit accepter une chaîne vide comme une variable absente', () => {
    process.env.MONGO_URI = '';
    expect(() => assertEnv()).toThrow(/MONGO_URI/);
  });

  /**
   * #248 — Vérifier la PRÉSENCE d'un secret ne suffit pas : `cp .env.example .env` remplit les trois
   * variables avec des marqueurs publiés dans ce dépôt, et le boot passait. Un secret connu de tous
   * n'est pas un secret ; ici il signe les cookies de session et ouvre l'ingestion capteurs.
   *
   * La démonstration locale reste possible, mais elle doit se DÉCLARER (`ALLOW_DEMO_SECRETS=1`,
   * posé par `.env.demo`) au lieu d'être le comportement obtenu par défaut.
   */
  describe('valeurs publiées (#248)', () => {
    beforeEach(() => {
      delete process.env.ALLOW_DEMO_SECRETS;
    });

    it('refuse un secret dont la valeur de démonstration est publiée dans le dépôt', () => {
      process.env.BETTER_AUTH_SECRET = 'secret-de-demo-docker-32-caracteres-minimum';
      expect(() => assertEnv()).toThrow(/BETTER_AUTH_SECRET/);
    });

    it('refuse un marqueur laissé par une copie de .env.example', () => {
      process.env.API_KEY = 'a-generer-voir-ci-dessus';
      expect(() => assertEnv()).toThrow(/API_KEY/);
    });

    it('refuse la clé capteurs de démonstration', () => {
      process.env.IOT_API_KEY = 'cle-capteurs-de-demo-docker-a-remplacer-en-production';
      expect(() => assertEnv()).toThrow(/IOT_API_KEY/);
    });

    it('nomme toutes les variables fautives dans un seul message', () => {
      process.env.BETTER_AUTH_SECRET = 'secret-de-demo-docker-32-caracteres-minimum';
      process.env.IOT_API_KEY = 'cle-capteurs-de-demo-docker-a-remplacer-en-production';
      expect(() => assertEnv()).toThrow(/BETTER_AUTH_SECRET[\s\S]*IOT_API_KEY/);
    });

    it('laisse passer la démonstration quand elle se déclare', () => {
      process.env.ALLOW_DEMO_SECRETS = '1';
      process.env.BETTER_AUTH_SECRET = 'secret-de-demo-docker-32-caracteres-minimum';
      expect(() => assertEnv()).not.toThrow();
    });

    it('laisse passer un secret réellement généré', () => {
      process.env.BETTER_AUTH_SECRET = 'K7dQ2mX9pL4vR8sT1wY6zB3nC5jH0gF';
      expect(() => assertEnv()).not.toThrow();
    });
  });
});
