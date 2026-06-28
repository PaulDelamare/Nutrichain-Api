import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response, NextFunction } from 'express';

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    batch: { findFirst: vi.fn() },
  },
}));

import { verifyBatchAccess } from './verifyBatchAccess.middleware';
import { prisma } from '../../../shared/configs/prismaClient.config';
import type { AuthenticatedRequest } from '../../identity/types/auth.types';
import { APIError } from '../../../shared/utils/errorHandler/APIError';

const buildReq = (overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest =>
  ({
    params: { id: 'batch-1' },
    activeOrgId: 'org-test',
    ...overrides,
  }) as unknown as AuthenticatedRequest;

const res = {} as Response;

describe('verifyBatchAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('doit lever APIError 400 si activeOrgId est absent', async () => {
    const next = vi.fn() as NextFunction;
    await verifyBatchAccess(buildReq({ activeOrgId: undefined }), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(APIError));
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as APIError;
    expect(err.status).toBe(400);
  });

  it("doit lever APIError 404 si le lot est introuvable dans l'organisation active", async () => {
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(null);
    const next = vi.fn() as NextFunction;

    await verifyBatchAccess(buildReq(), res, next);

    expect(prisma.batch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'batch-1', organization_id: 'org-test' },
      })
    );
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as APIError;
    expect(err.status).toBe(404);
    expect(err.body.error[0].message).toContain('introuvable dans votre organisation');
  });

  it('doit attacher req.batch et appeler next() si le lot existe dans la bonne org', async () => {
    const fakeBatch = { id: 'batch-1', organization_id: 'org-test', statut: 'EN_STOCK' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(fakeBatch as any);
    const req = buildReq();
    const next = vi.fn() as NextFunction;

    await verifyBatchAccess(req, res, next);

    expect(req.batch).toEqual(fakeBatch);
    expect(next).toHaveBeenCalledWith();
  });
});
