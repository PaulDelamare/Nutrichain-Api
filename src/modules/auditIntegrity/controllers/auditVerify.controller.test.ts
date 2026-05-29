import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';

vi.mock('../services/auditVerify.service', () => ({
  auditVerifyService: { verifyChain: vi.fn() },
}));

import { auditVerifyController } from './auditVerify.controller';
import { auditVerifyService } from '../services/auditVerify.service';
import type { AuthenticatedRequest } from '../../identity/types/auth.types';
import { APIError } from '../../../shared/utils/errorHandler/APIError';

const buildReq = (overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest =>
  ({
    activeOrgId: 'org-1',
    auth: { user: { id: 'admin' } },
    ...overrides,
  }) as unknown as AuthenticatedRequest;

const buildRes = (): { res: Response; capture: Record<string, unknown> } => {
  const capture: Record<string, unknown> = { headers: {} };
  const res = {
    status: (s: number) => {
      capture.status = s;
      return res as unknown as Response;
    },
    json: (p: unknown) => {
      capture.payload = p;
      return res as unknown as Response;
    },
    setHeader: (k: string, v: string) => {
      (capture.headers as Record<string, string>)[k] = v;
      return res as unknown as Response;
    },
  } as unknown as Response;
  return { res, capture };
};

describe('auditVerifyController', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('1. Happy : service retourne valid:true → 200 + Cache-Control no-store + payload complet', async () => {
    vi.mocked(auditVerifyService.verifyChain).mockResolvedValue({
      valid: true,
      rowsChecked: 42,
      lastSignatureHash: 'h-final',
      lastHorodatage: new Date('2026-05-29T11:00:00.000Z'),
      lastId: 42,
      brokenAtId: null,
      brokenAtReason: null,
      expectedRowCount: null,
      actualRowCount: null,
    });

    const { res, capture } = buildRes();
    await auditVerifyController(buildReq(), res, vi.fn());

    expect(capture.status).toBe(200);
    expect((capture.headers as Record<string, string>)['Cache-Control']).toBe('no-store');
    const payload = capture.payload as { data: { valid: boolean; rowsChecked: number } };
    expect(payload.data.valid).toBe(true);
    expect(payload.data.rowsChecked).toBe(42);
  });

  it('2. Broken : service retourne valid:false avec shape complet → 200 + brokenAtId + brokenAtReason présents', async () => {
    vi.mocked(auditVerifyService.verifyChain).mockResolvedValue({
      valid: false,
      rowsChecked: 10,
      lastSignatureHash: null,
      lastHorodatage: null,
      lastId: null,
      brokenAtId: 42,
      brokenAtReason: 'signature_mismatch',
      expectedRowCount: null,
      actualRowCount: null,
    });

    const { res, capture } = buildRes();
    await auditVerifyController(buildReq(), res, vi.fn());

    expect(capture.status).toBe(200);
    const payload = capture.payload as {
      data: {
        valid: boolean;
        brokenAtId: number | null;
        brokenAtReason: string | null;
      };
    };
    expect(payload.data.valid).toBe(false);
    expect(payload.data.brokenAtId).toBe(42);
    expect(payload.data.brokenAtReason).toBe('signature_mismatch');
  });

  it('3. activeOrgId absent → 400 (defense, ne devrait pas arriver après requireOrgRole)', async () => {
    const { res } = buildRes();
    const next = vi.fn();
    await auditVerifyController(buildReq({ activeOrgId: undefined }), res, next);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as APIError;
    expect(err.status).toBe(400);
  });
});
