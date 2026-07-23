import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveTrustedOrigins } from './trustedOrigins.config';

describe('resolveTrustedOrigins', () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    delete process.env.FRONTEND_URL;
    delete process.env.ADDITIONAL_TRUSTED_ORIGINS;
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it('inclut le front par defaut et le preview Vite hors production', () => {
    const origins = resolveTrustedOrigins();
    expect(origins).toContain('http://localhost:5173');
    expect(origins).toContain('http://localhost:4173');
  });

  it('reprend FRONTEND_URL quand il est defini', () => {
    process.env.FRONTEND_URL = 'https://app.nutrichain.fr';
    expect(resolveTrustedOrigins()).toContain('https://app.nutrichain.fr');
  });

  it('exclut le preview Vite en production', () => {
    process.env.NODE_ENV = 'production';
    expect(resolveTrustedOrigins()).not.toContain('http://localhost:4173');
  });

  it('ajoute l origine du mobile web declaree en variable d environnement', () => {
    process.env.ADDITIONAL_TRUSTED_ORIGINS = 'http://localhost:8081';
    expect(resolveTrustedOrigins()).toContain('http://localhost:8081');
  });

  it('accepte plusieurs origines separees par des virgules et les nettoie', () => {
    process.env.ADDITIONAL_TRUSTED_ORIGINS = ' http://localhost:8081 , https://demo.nutrichain.fr ';
    const origins = resolveTrustedOrigins();
    expect(origins).toContain('http://localhost:8081');
    expect(origins).toContain('https://demo.nutrichain.fr');
  });

  it('ignore les entrees vides de la liste additionnelle', () => {
    process.env.ADDITIONAL_TRUSTED_ORIGINS = 'http://localhost:8081,,  ,';
    const origins = resolveTrustedOrigins();
    expect(origins).toContain('http://localhost:8081');
    expect(origins.every((o) => o.length > 0)).toBe(true);
  });

  it('ne duplique pas une origine deja presente', () => {
    process.env.FRONTEND_URL = 'http://localhost:5173';
    process.env.ADDITIONAL_TRUSTED_ORIGINS = 'http://localhost:5173';
    const origins = resolveTrustedOrigins();
    expect(origins.filter((o) => o === 'http://localhost:5173')).toHaveLength(1);
  });
});
