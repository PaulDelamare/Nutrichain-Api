import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import { app } from '../../../../app';

/**
 * Test de CÂBLAGE, pas de logique : une garde écrite mais jamais branchée sur la route est un
 * défaut classique de ce dépôt. On vérifie donc que les deux routes existent réellement, qu'elles
 * passent par `sessionAuth`, et que l'étiquette sort en binaire.
 */
vi.mock('../../../../shared/middlewares/sessionAuth', () => ({
  sessionAuth: vi.fn(() => (req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, {
      activeOrgId: 'org_test_123',
      auth: { user: { id: 'u-123' }, activeOrgId: 'org_test_123', session: {} },
    });
    next();
  }),
}));

vi.mock('../../../../shared/configs/prismaClient.config', () => {
  const mock = {
    shipment: { findFirst: vi.fn() },
  };
  return { prisma: mock, bdd: mock };
});

const { prisma } = await import('../../../../shared/configs/prismaClient.config');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const shipmentMock = (prisma as any).shipment;

const SSCC = '034567890000000422';

describe('Logistics - Routes étiquette de palette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/logistics/shipments/:id/label rend un PNG, pas du JSON', async () => {
    shipmentMock.findFirst.mockResolvedValue({ shipment_id: SSCC });

    const res = await request(app).get('/api/logistics/shipments/exp-1/label');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.body.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  });

  // Une ressource privée dans un cache PARTAGÉ finit servie à qui n'a pas de session (cf. #278).
  it('l étiquette de palette n est jamais mise en cache partagé', async () => {
    shipmentMock.findFirst.mockResolvedValue({ shipment_id: SSCC });

    const res = await request(app).get('/api/logistics/shipments/exp-1/label');

    expect(res.headers['cache-control']).toContain('private');
    expect(res.headers['cache-control']).not.toContain('public');
  });

  it('GET /api/logistics/shipments/by-sscc/:sscc rend le contenu de la palette', async () => {
    shipmentMock.findFirst.mockResolvedValue({
      shipment_id: SSCC,
      transporteur: 'Transports Martin',
      date_envoi: new Date('2026-07-29T08:00:00Z'),
      statut_livraison: 'EN_TRANSIT',
      client: { nom_enseigne: 'Carrefour Rennes' },
      liaisons: [
        {
          quantite_expediee: 120,
          unite: 'KG',
          lot: {
            id: 'lot-1',
            lot_number: '260729-ABC123',
            statut: 'ALERTE',
            date_peremption: new Date('2026-08-29T21:59:59Z'),
            produit: { nom: 'Yaourt nature', code_gtin: '3042040209789' },
          },
        },
      ],
    });

    const res = await request(app).get(`/api/logistics/shipments/by-sscc/${SSCC}`);

    expect(res.status).toBe(200);
    expect(res.body.data.sscc).toBe(SSCC);
    expect(res.body.data.contient_lot_rappele).toBe(true);
    expect(res.body.data.lots).toHaveLength(1);
  });


  it('un SSCC de longueur invalide est rejeté avant d atteindre la base', async () => {
    const res = await request(app).get('/api/logistics/shipments/by-sscc/123');

    expect(res.status).toBe(400);
    expect(shipmentMock.findFirst).not.toHaveBeenCalled();
  });
});
