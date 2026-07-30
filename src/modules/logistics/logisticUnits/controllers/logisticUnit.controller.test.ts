import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Response } from 'express';
import { getLogisticUnitLabelController } from './logisticUnit.controller';
import { logisticUnitService } from '../services/logisticUnit.service';
import { labelService } from '../../shared/services/label.service';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';

vi.mock('../services/logisticUnit.service', () => ({
  logisticUnitService: { getSsccById: vi.fn() },
}));

const SSCC = '034567890000000606';

function buildResponse() {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    send: vi.fn(),
  };
  return { res, headers };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asRequest = (): AuthenticatedRequest => ({ params: { id: 'palette-1' }, activeOrgId: 'org-1' }) as any;

describe('getLogisticUnitLabelController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(logisticUnitService.getSsccById).mockResolvedValue(SSCC);
  });

  it('sert un vrai PNG portant l’element string du SSCC', async () => {
    const { res, headers } = buildResponse();

    await getLogisticUnitLabelController(asRequest(), res as unknown as Response, vi.fn());

    expect(headers['Content-Type']).toBe('image/png');
    const envoye = vi.mocked(res.send).mock.calls[0][0] as Buffer;
    // Signature PNG : on vérifie un vrai rendu, pas un objet quelconque.
    expect(envoye.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    expect(envoye.length).toBeGreaterThan(0);
  });

  /**
   * `public` est précisément la directive qui autorise un cache PARTAGÉ (proxy, CDN) à conserver
   * une réponse portant un en-tête d'autorisation : le SSCC d'une organisation pourrait alors être
   * resservi à un appelant sans session. Même contrat que l'étiquette de lot.
   */
  it('sert l’étiquette en cache PRIVÉ, jamais partagé ni immuable', async () => {
    const { res, headers } = buildResponse();

    await getLogisticUnitLabelController(asRequest(), res as unknown as Response, vi.fn());

    expect(headers['Cache-Control']).toBe('private, max-age=300');
    expect(headers['Cache-Control']).not.toContain('public');
    expect(headers['Cache-Control']).not.toContain('immutable');
  });

  it('demande le SSCC à l’organisation de la session, jamais à un identifiant du corps', async () => {
    const { res } = buildResponse();

    await getLogisticUnitLabelController(asRequest(), res as unknown as Response, vi.fn());

    expect(logisticUnitService.getSsccById).toHaveBeenCalledWith('palette-1', 'org-1');
  });

  it('encode exactement ce que le service d’étiquette produit', async () => {
    const { res } = buildResponse();
    const attendu = labelService.generateSsccElementString(SSCC);

    await getLogisticUnitLabelController(asRequest(), res as unknown as Response, vi.fn());

    expect(attendu).toBe(`00${SSCC}`);
    expect(res.send).toHaveBeenCalledTimes(1);
  });
});
