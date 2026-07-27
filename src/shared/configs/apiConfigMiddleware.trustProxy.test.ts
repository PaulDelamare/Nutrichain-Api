import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import configureMiddleware from './apiConfigMiddleware.config';

/**
 * #247 — `trust proxy` décidait à qui Express fait confiance pour recalculer `req.ip` depuis
 * `X-Forwarded-For`. La valeur `['loopback', 'linklocal', 'uniquelocal']` déclarait de confiance
 * tout l'espace privé RFC1918 alors qu'aucun reverse proxy ne figure dans la pile livrée : l'en-tête
 * venait donc de l'appelant, et `req.ip` devenait une valeur qu'il choisissait.
 *
 * Les limiteurs n'ont pas de `keyGenerator` : ils comptent par `req.ip`. Un appelant qui fait varier
 * l'en-tête change donc de compteur à chaque requête, et le limiteur anti-bruteforce ne freine plus
 * rien. Les journaux de `logs/` tracent au passage l'adresse qu'il a choisie.
 *
 * Un test de schéma ne prouverait pas le câblage : on monte réellement le middleware et on observe
 * `req.ip` et le compteur de bout en bout.
 */
function buildApp() {
  const app = express();
  configureMiddleware(app);
  app.get('/ping', (req, res) => res.json({ ip: req.ip }));
  return app;
}

describe('trust proxy (cablage apiConfigMiddleware)', () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    delete process.env.TRUST_PROXY_HOPS;
    delete process.env.RATE_LIMIT_MAX;
    delete process.env.RATE_LIMIT_WINDOW_MIN;
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("ignore X-Forwarded-For quand aucun proxy n'est declare", async () => {
    const app = buildApp();

    const usurpe = await request(app).get('/ping').set('X-Forwarded-For', '1.2.3.4');
    const nu = await request(app).get('/ping');

    expect(usurpe.body.ip).not.toBe('1.2.3.4');
    expect(usurpe.body.ip).toBe(nu.body.ip);
  });

  it('deux X-Forwarded-For differents partagent le meme compteur de limitation', async () => {
    // Le coeur de la faille : sans cette garantie, une seule machine dispose d'autant de quotas
    // qu'elle invente d'adresses.
    process.env.RATE_LIMIT_MAX = '2';
    const app = buildApp();

    const premier = await request(app).get('/ping').set('X-Forwarded-For', '10.0.0.1');
    const deuxieme = await request(app).get('/ping').set('X-Forwarded-For', '10.0.0.2');
    const troisieme = await request(app).get('/ping').set('X-Forwarded-For', '10.0.0.3');

    expect(premier.status).toBe(200);
    expect(deuxieme.status).toBe(200);
    expect(troisieme.status).toBe(429);
  });

  it('honore X-Forwarded-For quand un nombre de sauts est explicitement declare', async () => {
    // L'echappatoire pour un deploiement reellement derriere un ingress : elle doit etre choisie,
    // jamais subie.
    process.env.TRUST_PROXY_HOPS = '1';
    const app = buildApp();

    const res = await request(app).get('/ping').set('X-Forwarded-For', '1.2.3.4');

    expect(res.body.ip).toBe('1.2.3.4');
  });

  it('traite 0 comme « aucun proxy » et non comme une valeur absente', async () => {
    process.env.TRUST_PROXY_HOPS = '0';
    const app = buildApp();

    const res = await request(app).get('/ping').set('X-Forwarded-For', '1.2.3.4');

    expect(res.body.ip).not.toBe('1.2.3.4');
  });
});
