import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response, NextFunction } from 'express';

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    receipt: { findFirst: vi.fn() },
  },
}));

import { verifyReceiptAccess } from './verifyReceiptAccess.middleware';
import { prisma } from '../../../shared/configs/prismaClient.config';
import type { AuthenticatedRequest } from '../../identity/types/auth.types';
import { APIError } from '../../../shared/utils/errorHandler/APIError';

const buildReq = (overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest =>
  ({
    params: { id: 'receipt-1' },
    activeOrgId: 'org-test',
    ...overrides,
  }) as unknown as AuthenticatedRequest;

const res = {} as Response;

describe('verifyReceiptAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('doit lever APIError 400 si activeOrgId est absent', async () => {
    const next = vi.fn() as NextFunction;
    await verifyReceiptAccess(buildReq({ activeOrgId: undefined }), res, next);

    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as APIError;
    expect(err.status).toBe(400);
  });

  it("doit lever APIError 404 si la réception est introuvable dans l'organisation active", async () => {
    vi.mocked(prisma.receipt.findFirst).mockResolvedValue(null);
    const next = vi.fn() as NextFunction;

    await verifyReceiptAccess(buildReq(), res, next);

    expect(prisma.receipt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'receipt-1', organization_id: 'org-test' },
      })
    );
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as APIError;
    expect(err.status).toBe(404);
    expect(err.body.error[0].message).toContain('introuvable dans votre organisation');
  });

  it('doit attacher req.receipt et appeler next() si la réception existe dans la bonne org', async () => {
    const fakeReceipt = { id: 'receipt-1', organization_id: 'org-test' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.receipt.findFirst).mockResolvedValue(fakeReceipt as any);
    const req = buildReq();
    const next = vi.fn() as NextFunction;

    await verifyReceiptAccess(req, res, next);

    expect(req.receipt).toEqual(fakeReceipt);
    expect(next).toHaveBeenCalledWith();
  });
});
