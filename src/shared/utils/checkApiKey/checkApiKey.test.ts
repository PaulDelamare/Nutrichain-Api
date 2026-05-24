import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { checkApiKey } from './checkApiKey';

describe('checkApiKey', () => {
  const next: NextFunction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
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
});
