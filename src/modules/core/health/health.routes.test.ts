import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const tmpDirBase = path.join(os.tmpdir(), 'nutrichain-health-tests');

afterEach(async () => {
  // cleanup any tmp dirs
  await fs.rm(tmpDirBase, { recursive: true, force: true }).catch(() => {});
  vi.resetModules();
  vi.restoreAllMocks();
  delete process.env.LOG_DIR;
});

describe('Health route', () => {
  it('should return ok status with uptime and timestamp', async () => {
    // import fresh module
    const { default: healthRoutes } = await import('./health.routes');

    const app = express();
    app.use(healthRoutes);

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 200);
    expect(res.body).toHaveProperty('message', 'ok');
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('uptimeSeconds');
    expect(res.body.data).toHaveProperty('timestamp');
    expect(res.body.data).toHaveProperty('pid');
    expect(res.body.data).toHaveProperty('nodeVersion');
    expect(res.body.data).toHaveProperty('memory');
  });

  it('readiness returns ready when DB and logs are OK', async () => {
    const tmpDir = path.join(tmpDirBase, `ok-${Date.now()}`);
    process.env.LOG_DIR = tmpDir;

    // reset modules and mock the prisma client module used by the health controller
    vi.resetModules();
    vi.doMock('../../../shared/configs/prismaClient.config', () => ({
      bdd: {
        $queryRaw: vi.fn().mockResolvedValue(1),
        $queryRawUnsafe: vi
          .fn()
          .mockResolvedValue([{ id: '1', finished_at: new Date().toISOString() }]),
      },
    }));

    const { default: healthRoutes } = await import('./health.routes');
    const app = express();
    app.use(healthRoutes);

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 200);
    expect(res.body).toHaveProperty('message', 'ready');
    expect(res.body.data.summary.ready).toBe(true);

    type HealthCheck = { name: string; ok: boolean; optional?: boolean; error?: unknown };
    const checks: HealthCheck[] = res.body.data.checks;
    const dbCheck = checks.find((check) => check.name === 'database')!;
    const logsCheck = checks.find((check) => check.name === 'logs')!;
    const migrationsCheck = checks.find((check) => check.name === 'migrations')!;

    expect(dbCheck.ok).toBe(true);
    expect(logsCheck.ok).toBe(true);
    expect(migrationsCheck.optional).toBe(true);
  });

  it('readiness returns not ready when DB check fails', async () => {
    const tmpDir = path.join(tmpDirBase, `nok-${Date.now()}`);
    process.env.LOG_DIR = tmpDir;

    // reset modules and mock prisma to simulate DB down
    vi.resetModules();
    vi.doMock('../../../shared/configs/prismaClient.config', () => ({
      bdd: {
        $queryRaw: vi.fn().mockRejectedValue(new Error('DB down')),
        $queryRawUnsafe: vi.fn().mockRejectedValue(new Error('DB down')),
      },
    }));

    const { default: healthRoutes } = await import('./health.routes');
    const app = express();
    app.use(healthRoutes);

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty('status', 503);
    expect(res.body).toHaveProperty('message', 'not ready');
    expect(res.body.data.summary.ready).toBe(false);

    type HealthCheck = { name: string; ok: boolean; optional?: boolean; error?: unknown };
    const checks: HealthCheck[] = res.body.data.checks;
    const dbCheck = checks.find((check) => check.name === 'database')!;
    expect(dbCheck.ok).toBe(false);
    expect(dbCheck.error).toBeDefined();
  });

  it('readiness stays ready when migrations probe fails with column missing', async () => {
    const tmpDir = path.join(tmpDirBase, `migr-${Date.now()}`);
    process.env.LOG_DIR = tmpDir;

    vi.resetModules();
    const migrationError = new Error('migrations column missing') as Error & { code?: string };
    migrationError.code = '42703';

    vi.doMock('../../../shared/configs/prismaClient.config', () => ({
      bdd: {
        $queryRaw: vi.fn().mockResolvedValue(1),
        $queryRawUnsafe: vi.fn().mockImplementation(() => Promise.reject(migrationError)),
      },
    }));

    const { default: healthRoutes } = await import('./health.routes');
    const app = express();
    app.use(healthRoutes);

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 200);
    expect(res.body).toHaveProperty('message', 'ready');
    expect(res.body.data.summary.ready).toBe(true);

    type HealthCheck = { name: string; ok: boolean; optional?: boolean; error?: unknown };
    const checks: HealthCheck[] = res.body.data.checks;
    const migrationsCheck = checks.find((check) => check.name === 'migrations')!;
    expect(migrationsCheck.ok).toBe(false);
    expect(migrationsCheck.optional).toBe(true);
    expect(migrationsCheck.error).toBeDefined();
  });
});
