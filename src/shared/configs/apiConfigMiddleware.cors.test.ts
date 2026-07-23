import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import configureMiddleware from './apiConfigMiddleware.config';

// Un test de schema ne prouve pas le cablage : on monte reellement le middleware
// et on verifie que l'origine additionnelle est refletee par CORS de bout en bout.
function buildApp() {
  const app = express();
  configureMiddleware(app);
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('CORS (cablage apiConfigMiddleware)', () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    delete process.env.FRONTEND_URL;
    delete process.env.ADDITIONAL_TRUSTED_ORIGINS;
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it('reflete l origine du front par defaut', async () => {
    const res = await request(buildApp())
      .get('/ping')
      .set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('reflete l origine du mobile web declaree en variable d environnement', async () => {
    process.env.ADDITIONAL_TRUSTED_ORIGINS = 'http://localhost:8081';
    const res = await request(buildApp())
      .get('/ping')
      .set('Origin', 'http://localhost:8081');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8081');
  });

  it('ne reflete pas une origine non declaree', async () => {
    const res = await request(buildApp())
      .get('/ping')
      .set('Origin', 'http://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
