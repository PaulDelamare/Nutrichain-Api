import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import { ingestTelemetry } from './telemetry.controller';
import { TelemetryModel } from '../models/telemetry.model';
import { iotAlertService } from '../services/iotAlert.service';
import type { AuthenticatedRequest } from '../../identity/types/auth.types';

vi.mock('../models/telemetry.model', () => ({
  TelemetryModel: { create: vi.fn() },
}));
vi.mock('../services/iotAlert.service', () => ({
  iotAlertService: { checkAndAlert: vi.fn() },
}));
vi.mock('mongoose', () => ({
  default: {
    startSession: vi.fn().mockResolvedValue({ endSession: vi.fn().mockResolvedValue(undefined) }),
  },
}));

// Le contrôleur lit la trame VALIDÉE, pas `req.body` : reproduire ici l'état que produit
// réellement `validateTelemetryPing`, sinon le test valide un monde qui n'existe pas.
const buildReq = () =>
  ({
    validatedTelemetryPing: { sensor_id: 'S1', temperature: 8, humidity: 50, battery_level: 90 },
    activeOrgId: 'org-1',
  }) as unknown as AuthenticatedRequest;

const buildRes = () => {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('ingestTelemetry — la décision sanitaire ne peut pas être avalée', () => {
  beforeEach(() => vi.clearAllMocks());

  it('détection OK → 202 après persistance du point', async () => {
    vi.mocked(TelemetryModel.create).mockResolvedValue({} as never);
    vi.mocked(iotAlertService.checkAndAlert).mockResolvedValue(undefined);
    const res = buildRes();

    await ingestTelemetry(buildReq(), res, vi.fn());

    expect(TelemetryModel.create).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('détection en échec → PAS de 202, l’erreur remonte (le capteur ré-émet)', async () => {
    // Le point brut est persisté, mais l'alerte a échoué : répondre 202 ferait croire au capteur que
    // l'excursion est traitée alors que les lots ne sont PAS mis en quarantaine. On propage.
    vi.mocked(TelemetryModel.create).mockResolvedValue({} as never);
    const boom = new Error('serialization failure');
    vi.mocked(iotAlertService.checkAndAlert).mockRejectedValue(boom);
    const res = buildRes();
    const next = vi.fn();

    await ingestTelemetry(buildReq(), res, next);

    // catchAsync route l'erreur vers next → le globalErrorHandler répond 500 ; jamais 202.
    expect(next).toHaveBeenCalledWith(boom);
    expect(res.status).not.toHaveBeenCalledWith(202);
  });
});
