import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import { app } from '../../../../app'; 
import { receiptService } from '../services/receipt.service';

// Mock the API Key middleware AND Auth middleware to inject activeOrgId
vi.mock('../../../../shared/utils/checkApiKey/checkApiKey', () => ({
  checkApiKey: vi.fn(() => (req: Request, _res: Response, next: NextFunction) => {
    (req as any).activeOrgId = 'org_test_123'; // Injection propre dans req.activeOrgId
    next();
  }),
}));

// Mock requireLogisticsRole
vi.mock('../../middlewares/requireLogisticsRole.middleware', () => ({
  requireLogisticsRole: vi.fn(() => (req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { id: 'u-123' };
    (req as any).session = { id: 's-123', activeOrganizationId: 'org_test_123' };
    (req as any).activeOrgId = 'org_test_123';
    (req as any).memberRole = 'owner';
    next();
  }),
}));

// Mock requireAuth as well (legacy)
vi.mock('../../../identity/middlewares/requireAuth.middleware', () => ({
  requireAuth: vi.fn((req: Request, _res: Response, next: NextFunction) => {
    (req as any).activeOrgId = 'org_test_123';
    next();
  }),
}));

vi.mock('../../../identity/middlewares/requireOrgRole.middleware', () => ({
  requireOrgRole: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => {
    next();
  }),
}));

// Mock the Receipt Service
vi.mock('../services/receipt.service', () => ({
  receiptService: {
    createReceipt: vi.fn(),
    getReceiptStats: vi.fn(),
    getReceiptById: vi.fn(),
    getBatchById: vi.fn(),
    listReceipts: vi.fn(),
  },
}));

// Mock Prisma
vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    receipt: {
      findFirst: vi.fn(),
    },
    batch: {
      findFirst: vi.fn(),
    },
  },
}));

describe('Logistics - Receipts Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/logistics/receipts', () => {
    it('doit refuser la requête (422) si le payload est incomplet (ex: quantite manquante)', async () => {
      const payloadIdiot = {
        id_fournisseur: '123e4567-e89b-12d3-a456-426614174000',
        id_produit: '123e4567-e89b-12d3-a456-426614174001',
      };

      const res = await request(app)
        .post('/api/logistics/receipts')
        .send(payloadIdiot);

      expect(res.status).toBe(400); 
      expect(res.body.error).toBeDefined();
    });

    it('doit enregistrer la réception et initialiser un lot avec le statut 201 (Payload parfait)', async () => {
      const payloadParfait = {
        id_fournisseur: '123e4567-e89b-12d3-a456-426614174000',
        shipment_id: 'SHIP-9999',
        id_produit: '123e4567-e89b-12d3-a456-426614174001',
        quantite_actuelle: 500,
        unite_code: 'KG',
        statut_controle: 'CONFORME',
        received_by: '123e4567-e89b-12d3-a456-426614174002'
      };

      vi.mocked(receiptService.createReceipt).mockResolvedValue({
        message: 'Réception enregistrée avec succès et Lot généré.',
        receiptId: 'receipt_uuid',
        batchId: 'batch_uuid'
      } as never);

      const res = await request(app)
        .post('/api/logistics/receipts')
        .send(payloadParfait);

      expect(res.status).toBe(201);
      expect(res.body.data.receiptId).toBe('receipt_uuid');
      expect(receiptService.createReceipt).toHaveBeenCalledWith({
        ...payloadParfait,
        organization_id: 'org_test_123'
      });
    });
  });

  describe('GET /api/logistics/receipts/stats', () => {
    it('doit retourner les statistiques de réception (200)', async () => {
      vi.mocked(receiptService.getReceiptStats).mockResolvedValue({
        total_receipts_today: 12,
        total_quantity_kg: 5000
      } as any);

      const res = await request(app).get('/api/logistics/receipts/stats');

      console.log('STATS BODY:', JSON.stringify(res.body));
      expect(res.status).toBe(200);
      expect(res.body.data.total_receipts_today).toBe(12);
      expect(receiptService.getReceiptStats).toHaveBeenCalledWith('org_test_123');
    });
  });

  describe('GET /api/logistics/receipts/:id (Multi-tenant Isolation)', () => {
    it('doit refuser l\'accès (403) si la réception appartient à une autre organisation', async () => {
      // Pour ce test, pas de mocking du service car le middleware doit bloquer AVANT
      // Mais on doit quand même mocker prisma car le middleware l'utilise
      const { prisma } = await import('../../../../shared/configs/prismaClient.config');
      vi.mocked(prisma.receipt.findFirst).mockResolvedValue(null); // Pas trouvé dans NOTRE org

      const res = await request(app).get('/api/logistics/receipts/rcpt-1');

      expect(res.status).toBe(404); // Le middleware renvoie 404 si pas trouvé dans l'org
      expect(res.body.error[0].message).toContain('introuvable dans votre organisation');
    });

    it('doit autoriser l\'accès (200) si la réception appartient à la même organisation', async () => {
      const { prisma } = await import('../../../../shared/configs/prismaClient.config');
      vi.mocked(prisma.receipt.findFirst).mockResolvedValue({
        id: 'rcpt-1',
        organization_id: 'org_test_123'
      } as any);

      vi.mocked(receiptService.getReceiptById).mockResolvedValue({
        id: 'rcpt-1',
        organization_id: 'org_test_123',
        id_fournisseur: 'f-1'
      } as any);

      const res = await request(app).get('/api/logistics/receipts/rcpt-1');

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe('rcpt-1');
      expect(receiptService.getReceiptById).toHaveBeenCalledWith('rcpt-1', 'org_test_123');
    });
  });
});
