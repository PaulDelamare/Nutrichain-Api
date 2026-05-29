import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response, NextFunction } from 'express';
import type { Alert } from '@prisma/client';

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    alert: { findFirst: vi.fn() },
  },
}));

import { verifyAlertAccess } from './verifyAlertAccess.middleware';
import { prisma } from '../../../shared/configs/prismaClient.config';
import type { AuthenticatedRequest } from '../../identity/types/auth.types';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { ALERT_NOT_FOUND_MSG } from '../constants/alert.constants';

const buildReq = (overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest =>
  ({
    params: { id: 'alert-abc' },
    activeOrgId: 'org-test',
    ...overrides,
  }) as unknown as AuthenticatedRequest;

const res = {} as Response;

describe('verifyAlertAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. Alert trouvée dans la bonne org → next() + req.alert attaché', async () => {
    const fakeAlert = {
      id: 'alert-abc',
      organization_id: 'org-test',
      statut: 'ACTIVE',
      type: 'TEMP_EXCURSION',
    } as Alert;
    vi.mocked(prisma.alert.findFirst).mockResolvedValue(fakeAlert);
    const req = buildReq();
    const next = vi.fn() as NextFunction;

    await verifyAlertAccess(req, res, next);

    expect(prisma.alert.findFirst).toHaveBeenCalledWith({
      where: { id: 'alert-abc', organization_id: 'org-test' },
    });
    expect(req.alert).toEqual(fakeAlert);
    expect(next).toHaveBeenCalledWith();
  });

  it("2. Alert d'une autre org → 404 avec message constant exact", async () => {
    vi.mocked(prisma.alert.findFirst).mockResolvedValue(null);
    const next = vi.fn() as NextFunction;

    await verifyAlertAccess(buildReq(), res, next);

    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as APIError;
    expect(err.status).toBe(404);
    expect(err.body.error[0].message).toBe(ALERT_NOT_FOUND_MSG);
  });

  it('3. Alert inexistante → 404 avec MÊME constante (anti-enumeration)', async () => {
    vi.mocked(prisma.alert.findFirst).mockResolvedValue(null);
    const next = vi.fn() as NextFunction;

    await verifyAlertAccess(buildReq({ params: { id: 'does-not-exist' } as never }), res, next);

    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as APIError;
    expect(err.status).toBe(404);
    expect(err.body.error[0].message).toBe(ALERT_NOT_FOUND_MSG);
  });

  it('4. req.params.id malformé (pas UUID) → laissé passer au findFirst → 404 même constante', async () => {
    vi.mocked(prisma.alert.findFirst).mockResolvedValue(null);
    const next = vi.fn() as NextFunction;

    await verifyAlertAccess(buildReq({ params: { id: 'not-a-uuid-***' } as never }), res, next);

    expect(prisma.alert.findFirst).toHaveBeenCalled();
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as APIError;
    expect(err.status).toBe(404);
    expect(err.body.error[0].message).toBe(ALERT_NOT_FOUND_MSG);
  });

  it('5. activeOrgId absent → 404 même constante (collapse anti-enumeration)', async () => {
    const next = vi.fn() as NextFunction;

    await verifyAlertAccess(buildReq({ activeOrgId: undefined }), res, next);

    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as APIError;
    expect(err.status).toBe(404);
    expect(err.body.error[0].message).toBe(ALERT_NOT_FOUND_MSG);
  });
});
