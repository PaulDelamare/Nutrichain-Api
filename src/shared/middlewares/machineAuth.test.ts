import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response, NextFunction } from 'express';

vi.mock('../utils/iotGateway/iotGateway', () => ({
  resolveGatewayOrg: vi.fn(),
}));

import { machineAuth } from './machineAuth';
import { resolveGatewayOrg } from '../utils/iotGateway/iotGateway';
import { APIError } from '../utils/errorHandler/APIError';
import { AuthenticatedRequest } from '../../modules/identity/types/auth.types';

const buildReq = (cle?: string) =>
  ({
    header: (nom: string) => (nom === 'x-api-key' ? cle : undefined),
  }) as unknown as AuthenticatedRequest;

describe('machineAuth', () => {
  const res = {} as Response;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("estampille la trame de l'organisation DE LA PASSERELLE, pas de celle du .env", async () => {
    // Le cœur de #93 : deux passerelles distinctes doivent aboutir dans deux organisations
    // distinctes. Avant, toutes deux tombaient sur `API_KEY_ORG_ID`.
    vi.mocked(resolveGatewayOrg).mockResolvedValue('org-b');
    const next = vi.fn() as unknown as NextFunction;
    const req = buildReq('cle-de-org-b');

    await machineAuth()(req, res, next);

    expect(resolveGatewayOrg).toHaveBeenCalledWith('cle-de-org-b');
    expect(req.activeOrgId).toBe('org-b');
    expect(req.auth?.activeOrgId).toBe('org-b');
    expect(next).toHaveBeenCalledWith();
  });

  it('refuse une clé inconnue ou révoquée', async () => {
    // Sans organisation résolue, la trame n'a pas de tenant sûr : elle ne doit pas passer.
    vi.mocked(resolveGatewayOrg).mockResolvedValue(null);
    const next = vi.fn() as unknown as NextFunction;
    const req = buildReq('cle-revoquee');

    await machineAuth()(req, res, next);

    const erreur = vi.mocked(next).mock.calls[0][0] as APIError;
    expect(erreur).toBeInstanceOf(APIError);
    expect(erreur.status).toBe(401);
    expect(req.activeOrgId).toBeUndefined();
  });

  it("refuse l'absence de clé sans interroger la base", async () => {
    const next = vi.fn() as unknown as NextFunction;

    await machineAuth()(buildReq(undefined), res, next);

    expect(resolveGatewayOrg).not.toHaveBeenCalled();
    expect((vi.mocked(next).mock.calls[0][0] as APIError).status).toBe(401);
  });

  it('propage une panne de base au lieu de laisser passer la trame', async () => {
    vi.mocked(resolveGatewayOrg).mockRejectedValue(new Error('db down'));
    const next = vi.fn() as unknown as NextFunction;
    const req = buildReq('cle');

    await machineAuth()(req, res, next);

    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(Error);
    expect(req.activeOrgId).toBeUndefined();
  });
});
