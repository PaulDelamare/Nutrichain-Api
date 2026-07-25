import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../types/auth.types';

vi.mock('../services/account.service', () => ({
  accountService: { deleteMyAccount: vi.fn() },
}));

import { deleteMyAccountController } from './account.controller';
import { accountService } from '../services/account.service';

describe('deleteMyAccountController', () => {
  const buildRes = () => {
    const res = {} as Response;
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  };

  beforeEach(() => vi.clearAllMocks());

  it("appelle le service avec l'ID de la SESSION, jamais un ID venu du corps ou des params", async () => {
    const req = {
      auth: { user: { id: 'user-session' } },
      body: { id: 'user-usurpe' },
      params: { id: 'user-usurpe' },
    } as unknown as AuthenticatedRequest;

    await deleteMyAccountController(req, buildRes(), vi.fn());

    expect(accountService.deleteMyAccount).toHaveBeenCalledWith('user-session');
  });

  it('transmet une erreur 401 à next() sans session authentifiée, sans jamais appeler le service', async () => {
    const req = { auth: undefined, body: {}, params: {} } as unknown as AuthenticatedRequest;
    const next = vi.fn();

    await deleteMyAccountController(req, buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
    expect(accountService.deleteMyAccount).not.toHaveBeenCalled();
  });
});
