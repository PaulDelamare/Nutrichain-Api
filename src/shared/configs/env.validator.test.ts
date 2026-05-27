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
});
