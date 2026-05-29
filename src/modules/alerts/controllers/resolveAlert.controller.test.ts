import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import { Alert } from '@prisma/client';

vi.mock('../services/alert.service', () => ({
  alertService: { resolveAlert: vi.fn() },
}));

import { resolveAlertController } from './resolveAlert.controller';
import { alertService } from '../services/alert.service';
import type { AuthenticatedRequest } from '../../identity/types/auth.types';

const buildAlert = (overrides: Partial<Alert> = {}): Alert =>
  ({
    id: 'alert-1',
    organization_id: 'org-1',
    type: 'TEMP_EXCURSION',
    niveau_gravite: 'PANIC',
    message: 'msg',
    id_materiel: 'eq-1',
    related_entity: 'Equipment',
    related_id: 'eq-1',
    statut: 'RESOLVED',
    created_at: new Date(),
    resolved_by: 'user-1',
    resolved_at: new Date(),
    ...overrides,
  }) as Alert;

const buildRes = (): { res: Response; capture: { status?: number; payload?: unknown } } => {
  const capture: { status?: number; payload?: unknown } = {};
  const res = {
    status: (s: number) => {
      capture.status = s;
      return res as unknown as Response;
    },
    json: (p: unknown) => {
      capture.payload = p;
      return res as unknown as Response;
    },
  } as unknown as Response;
  return { res, capture };
};

const buildReq = (overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest =>
  ({
    auth: { user: { id: 'user-resolver' } },
    alert: buildAlert(),
    validatedResolveAlert: {},
    ...overrides,
  }) as unknown as AuthenticatedRequest;

describe('resolveAlertController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. happy path TEMP_EXCURSION → 200 + message 'résolue avec succès' (sans suffixe Recall)", async () => {
    const resolvedAlert = buildAlert({ statut: 'RESOLVED' });
    vi.mocked(alertService.resolveAlert).mockResolvedValue({
      alert: resolvedAlert,
      alreadyResolved: false,
    });
    const req = buildReq();
    const { res, capture } = buildRes();

    await resolveAlertController(req, res, vi.fn());

    expect(capture.status).toBe(200);
    const payload = capture.payload as { message: string; data: { alert: Alert } };
    expect(payload.message).toContain('Alerte résolue avec succès');
    expect(payload.message).not.toContain('rappel produit');
    expect(payload.data.alert).toEqual(resolvedAlert);
  });

  it("2. PRODUCT_RECALL → message contient le warning 'rappel produit lui-même n'est pas clôturé'", async () => {
    const recallAlert = buildAlert({ type: 'PRODUCT_RECALL', statut: 'RESOLVED' });
    vi.mocked(alertService.resolveAlert).mockResolvedValue({
      alert: recallAlert,
      alreadyResolved: false,
    });
    const req = buildReq({ alert: buildAlert({ type: 'PRODUCT_RECALL' }) });
    const { res, capture } = buildRes();

    await resolveAlertController(req, res, vi.fn());

    expect(capture.status).toBe(200);
    const payload = capture.payload as { message: string };
    expect(payload.message).toContain("rappel produit lui-même n'est pas clôturé");
  });

  it("3. idempotent → message 'déjà résolue (idempotent)'", async () => {
    const resolvedAlert = buildAlert({ statut: 'RESOLVED' });
    vi.mocked(alertService.resolveAlert).mockResolvedValue({
      alert: resolvedAlert,
      alreadyResolved: true,
    });
    const req = buildReq();
    const { res, capture } = buildRes();

    await resolveAlertController(req, res, vi.fn());

    const payload = capture.payload as { message: string };
    expect(payload.message).toContain('déjà résolue');
    expect(payload.message).toContain('idempotent');
  });

  it("4. PRODUCT_RECALL idempotent → message cumule 'idempotent' + warning Recall", async () => {
    const recallAlert = buildAlert({ type: 'PRODUCT_RECALL', statut: 'RESOLVED' });
    vi.mocked(alertService.resolveAlert).mockResolvedValue({
      alert: recallAlert,
      alreadyResolved: true,
    });
    const req = buildReq({ alert: buildAlert({ type: 'PRODUCT_RECALL' }) });
    const { res, capture } = buildRes();

    await resolveAlertController(req, res, vi.fn());

    const payload = capture.payload as { message: string };
    expect(payload.message).toContain('idempotent');
    expect(payload.message).toContain("rappel produit lui-même n'est pas clôturé");
  });
});
