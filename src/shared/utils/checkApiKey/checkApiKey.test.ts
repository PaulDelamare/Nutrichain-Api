import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { checkApiKey } from './checkApiKey';
import type { AuthenticatedRequest } from '../../../modules/identity/types/auth.types';

describe('checkApiKey', () => {
  const next: NextFunction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.API_KEY_ORG_ID;
    delete process.env.API_KEY;
  });

  it('Should pass if the API key is valid', async () => {
    const validApiKey = 'VALID_API_KEY';

    const middleware = checkApiKey(validApiKey);

    const req = {
      header: vi.fn().mockReturnValue('VALID_API_KEY'),
    } as unknown as Request;

    const res = {} as Response;

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('Should return a 401 error if the API key is invalid', async () => {
    const validApiKey = 'VALID_API_KEY';

    const middleware = checkApiKey(validApiKey);

    const req = {
      header: vi.fn().mockReturnValue('INVALID_API_KEY'),
    } as unknown as Request;

    const res = {} as Response;

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 401,
      })
    );
  });

  it('Should return a 401 error if the API key is missing', async () => {
    const validApiKey = 'VALID_API_KEY';

    const middleware = checkApiKey(validApiKey);

    const req = {
      header: vi.fn().mockReturnValue(null),
    } as unknown as Request;

    const res = {} as Response;

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 401,
      })
    );
  });

  describe('env-bound org binding (Sec A — rejet x-org-id)', () => {
    const buildReq = (apiKey: string | null, xOrgId: string | null = null): AuthenticatedRequest =>
      ({
        header: vi.fn((name: string) => {
          if (name === 'x-api-key') return apiKey;
          if (name === 'x-org-id') return xOrgId;
          return undefined;
        }),
      }) as unknown as AuthenticatedRequest;

    it('doit ignorer x-org-id et utiliser API_KEY_ORG_ID env (rejet spoofing)', async () => {
      process.env.API_KEY = 'KEY';
      process.env.API_KEY_ORG_ID = 'org-from-env';
      const middleware = checkApiKey();
      const req = buildReq('KEY', 'org-SPOOFED-by-client');
      const res = {} as Response;

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.activeOrgId).toBe('org-from-env');
    });

    it('doit injecter activeOrgId depuis API_KEY_ORG_ID quand x-org-id absent', async () => {
      process.env.API_KEY = 'KEY';
      process.env.API_KEY_ORG_ID = 'org-from-env';
      const middleware = checkApiKey();
      const req = buildReq('KEY');
      const res = {} as Response;

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.activeOrgId).toBe('org-from-env');
    });

    it("ne doit pas injecter activeOrgId si aucune source d'org (mode frontend-gate)", async () => {
      process.env.API_KEY = 'KEY';
      delete process.env.API_KEY_ORG_ID;
      const middleware = checkApiKey();
      const req = buildReq('KEY');
      const res = {} as Response;

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.activeOrgId).toBeUndefined();
    });
  });
});
