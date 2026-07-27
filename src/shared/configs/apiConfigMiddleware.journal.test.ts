import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'path';
import os from 'os';

vi.mock('../utils/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import configureMiddleware from './apiConfigMiddleware.config';
import { logger } from '../utils/logger/logger';

/**
 * #253 — Le middleware global journalise l'URL complète de CHAQUE requête, à deux endroits :
 * ici (Winston → `logs/app-*.log` et la console) et dans `requestLog` (→ `logs/request.log`).
 * Le jeton d'invitation voyageait dans le chemin, il partait donc dans les deux.
 *
 * Un test sur `redactUrl` seul ne prouverait pas le câblage : c'est celui-ci qui échoue si
 * quelqu'un remet `req.url` brut dans la ligne de journal.
 */
function buildApp() {
  const app = express();
  configureMiddleware(app);
  app.get('/api/identity/invitations/:token/preview', (_req, res) => res.json({ ok: true }));
  app.get('/api/me', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('journalisation des requêtes (cablage apiConfigMiddleware)', () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    vi.mocked(logger.info).mockClear();
    // Isole les écritures de `requestLog`, qui tourne dans le même middleware.
    process.env.LOG_DIR = path.join(os.tmpdir(), `nutrichain-journal-${Date.now()}`);
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  const lignesJournalisees = () =>
    vi.mocked(logger.info).mock.calls.map((c) => String(c[0]));

  it("ne journalise pas le jeton d'invitation", async () => {
    const jeton = '33333333-3333-4333-8333-333333333333';

    await request(buildApp()).get(`/api/identity/invitations/${jeton}/preview`);

    const lignes = lignesJournalisees().join('\n');
    expect(lignes).not.toContain(jeton);
    expect(lignes).toContain('/api/identity/invitations/');
  });

  it('journalise normalement une URL sans secret', async () => {
    // Une rédaction trop large priverait le diagnostic de l'essentiel.
    await request(buildApp()).get('/api/me');

    expect(lignesJournalisees().join('\n')).toContain('/api/me');
  });
});
