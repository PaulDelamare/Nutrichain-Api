import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import { app } from '../../../../app';

// sessionAuth : injecte une org active + un utilisateur de session (comme une vraie session web)
vi.mock('../../../../shared/middlewares/sessionAuth', () => ({
  sessionAuth: vi.fn(() => (req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, {
      activeOrgId: 'org_test_123',
      user: { id: 'u-123' },
      auth: { user: { id: 'u-123' }, activeOrgId: 'org_test_123', session: {} },
    });
    next();
  }),
}));

// Prisma mocké : $transaction passe le mock au callback du service.
vi.mock('../../../../shared/configs/prismaClient.config', () => {
  const mock: Record<string, unknown> = {
    customer: { findFirst: vi.fn() },
    shipment: { count: vi.fn().mockResolvedValue(0), create: vi.fn() },
    batch: { findFirst: vi.fn(), update: vi.fn() },
    liaison_Shipment: { create: vi.fn() },
    batch_Mouvement: { create: vi.fn() },
    ePCIS_Event: { create: vi.fn() },
  };
  mock.$transaction = vi.fn((cb: (tx: unknown) => unknown) => cb(mock));
  return { prisma: mock, bdd: mock };
});

const validPayload = {
  id_client: '123e4567-e89b-12d3-a456-426614174000',
  shipment_id: 'SHIP-TEST-1',
  transporteur: 'DHL',
  destination_adresse: '12 rue de la Livraison',
  created_by: '123e4567-e89b-12d3-a456-426614174002',
  lots: [{ id_lot: '123e4567-e89b-12d3-a456-426614174001', quantite_expediee: 5 }],
};

describe('Logistics - Shipments Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuse (404) si le client destinataire appartient à une autre organisation', async () => {
    const { prisma } = await import('../../../../shared/configs/prismaClient.config');
    // Le client n'est pas trouvé dans l'org active → la garde multi-tenant rejette.
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(null);

    const res = await request(app).post('/api/logistics/shipments').send(validPayload);

    expect(res.status).toBe(404);
    expect(res.body.error[0].field).toBe('id_client');
    // Aucune expédition n'est créée.
    expect(prisma.shipment.create).not.toHaveBeenCalled();
  });

  it('refuse (400) un payload invalide avant toute logique métier', async () => {
    const { prisma } = await import('../../../../shared/configs/prismaClient.config');

    // Un SSCC malformé : SEULE la validation VineJS peut le refuser. Ce test portait auparavant sur
    // `lots: []`, que le service refuse désormais lui-même — il restait donc vert même en démontant
    // `validateShipmentPayload` de la route, et ne prouvait plus le câblage qu'il existe pour prouver.
    const res = await request(app)
      .post('/api/logistics/shipments')
      .send({ ...validPayload, palettes: ['PAS-UN-SSCC'] });

    expect(res.status).toBe(400);
    expect(res.body.error[0].field).toBe('palettes.0');
    // Avant toute logique métier : le service n'est jamais entré.
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
  });
});
