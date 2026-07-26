import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { NextFunction, Response } from 'express';
import request from 'supertest';
import { requestMetricsMiddleware } from './requestMetrics.middleware';
import { AuthenticatedRequest } from '../../identity/types/auth.types';

vi.mock('./metricsStore', () => ({
  recordRequestSample: vi.fn(),
}));

import { recordRequestSample } from './metricsStore';

describe('requestMetricsMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. requête réussie sur une route authentifiée : method/route/statusCode/durationMs/organizationId enregistrés', async () => {
    const app = express();
    app.use(requestMetricsMiddleware);
    app.get('/api/catalog/:id', (req, res) => {
      (req as AuthenticatedRequest).activeOrgId = 'org-1';
      res.status(200).json({ ok: true });
    });

    await request(app).get('/api/catalog/abc');

    expect(recordRequestSample).toHaveBeenCalledTimes(1);
    const sample = vi.mocked(recordRequestSample).mock.calls[0][0];
    expect(sample.method).toBe('GET');
    expect(sample.route).toBe('/api/catalog/:id');
    expect(sample.statusCode).toBe(200);
    expect(sample.durationMs).toBeGreaterThanOrEqual(0);
    expect(sample.organizationId).toBe('org-1');
  });

  it("2. route non résolue (404, req.route jamais défini) : AUCUN échantillon enregistré", async () => {
    const app = express();
    app.use(requestMetricsMiddleware);

    await request(app).get('/api/does-not-exist');

    expect(recordRequestSample).not.toHaveBeenCalled();
  });

  it('3. route existante mais sans organisation active (route publique) : organizationId = null', async () => {
    const app = express();
    app.use(requestMetricsMiddleware);
    app.get('/health', (_req, res) => res.status(200).json({ ok: true }));

    await request(app).get('/health');

    const sample = vi.mocked(recordRequestSample).mock.calls[0][0];
    expect(sample.organizationId).toBeNull();
  });

  it('4. erreur serveur (500) sur route authentifiée : statusCode 500 remonté avec organizationId', async () => {
    const app = express();
    app.use(requestMetricsMiddleware);
    app.get('/api/boom', (req: express.Request, res: Response, _next: NextFunction) => {
      (req as AuthenticatedRequest).activeOrgId = 'org-1';
      res.status(500).json({ error: 'boom' });
    });

    await request(app).get('/api/boom');

    const sample = vi.mocked(recordRequestSample).mock.calls[0][0];
    expect(sample.statusCode).toBe(500);
    expect(sample.organizationId).toBe('org-1');
  });
});
