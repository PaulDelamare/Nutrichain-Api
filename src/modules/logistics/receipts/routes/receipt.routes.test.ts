import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import { app } from '../../../../app';
import { receiptService } from '../services/receipt.service';
import { batchService } from '../../shared/services/batch.service';
import { Receipt, Supplier } from '@prisma/client';

// On définit un type pour la réponse de getReceiptById qui inclut la relation fournisseur
type ReceiptWithSupplier = Receipt & { fournisseur: Supplier };

/**
 * Une session authentifiée est simulée : ce fichier teste le COMPORTEMENT des routes, pas leurs
 * gardes. Le refus de la clé API seule est prouvé contre les middlewares RÉELS, ailleurs
 * (`sessionAuth.test.ts`, `connector.security.test.ts`, `receipt.roles.test.ts`) — un test d'accès
 * qui simule sa propre garde ne prouve rien.
 */
// `vi.hoisted` : les fabriques de `vi.mock` sont remontées en tête de fichier, elles ne peuvent
// donc pas lire une constante déclarée après elles.
const { sessionAuthentifiee } = vi.hoisted(() => ({
  sessionAuthentifiee: (req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, {
      activeOrgId: 'org_test_123',
      auth: {
        user: { id: 'u-123', email: 'test@nutrichain.local' },
        activeOrgId: 'org_test_123',
        session: { activeOrganizationId: 'org_test_123' },
      },
    });
    next();
  },
}));

vi.mock('../../../../shared/middlewares/sessionAuth', () => ({
  sessionAuth: vi.fn(() => sessionAuthentifiee),
}));

// Mock the legacy middlewares for safety if still imported somewhere
vi.mock('../../../../shared/utils/checkApiKey/checkApiKey', () => ({
  checkApiKey: vi.fn(() => (req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, { activeOrgId: 'org_test_123' });
    next();
  }),
}));

vi.mock('../../middlewares/requireLogisticsRole.middleware', () => ({
  requireLogisticsRole: vi.fn(() => (req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, {
      user: { id: 'u-123' },
      session: { id: 's-123', activeOrganizationId: 'org_test_123' },
      activeOrgId: 'org_test_123',
    });
    next();
  }),
}));

// Mock requireAuth as well (legacy)
vi.mock('../../../identity/middlewares/requireAuth.middleware', () => ({
  requireAuth: vi.fn((req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, { activeOrgId: 'org_test_123' });
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

// Mock the Batch Service (levée de quarantaine)
vi.mock('../../shared/services/batch.service', () => ({
  batchService: {
    liftQuarantine: vi.fn(),
    scrapBatch: vi.fn(),
  },
}));

// Mock Prisma — partagé entre `prisma` (services) et `bdd` (better-auth via auth.config)
vi.mock('../../../../shared/configs/prismaClient.config', () => {
  const mock = {
    receipt: { findFirst: vi.fn() },
    batch: { findFirst: vi.fn() },
  };
  return { prisma: mock, bdd: mock };
});

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

      const res = await request(app).post('/api/logistics/receipts').send(payloadIdiot);

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
        statut_controle: 'OK',
        received_by: '123e4567-e89b-12d3-a456-426614174002',
      };

      vi.mocked(receiptService.createReceipt).mockResolvedValue({
        message: 'Réception enregistrée avec succès et Lot généré.',
        receiptId: 'receipt_uuid',
        batchId: 'batch_uuid',
      } as never);

      const res = await request(app).post('/api/logistics/receipts').send(payloadParfait);

      expect(res.status).toBe(201);
      expect(res.body.data.receiptId).toBe('receipt_uuid');
      expect(receiptService.createReceipt).toHaveBeenCalledWith(
        expect.objectContaining({
          id_fournisseur: payloadParfait.id_fournisseur,
          organization_id: 'org_test_123',
        })
      );
    });
  });

  describe('GET /api/logistics/receipts/:id', () => {
    it('doit retourner 404 si la réception appartient à une autre organisation', async () => {
      vi.mocked(receiptService.getReceiptById).mockRejectedValue({
        status: 404,
        error: [{ field: 'receipt', message: 'Réception introuvable' }],
      });

      const res = await request(app)
        .get('/api/logistics/receipts/autre-org-id')
        .set('Authorization', 'Bearer token_valide');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/logistics/receipts/stats', () => {
    it('doit retourner les statistiques de réception (200)', async () => {
      vi.mocked(receiptService.getReceiptStats).mockResolvedValue({
        total_receipts_today: 12,
        total_quantity_kg: 5000,
      } as unknown as { total_receipts_today: number; total_quantity_kg: number });

      const res = await request(app).get('/api/logistics/receipts/stats');

      expect(res.status).toBe(200);
      expect(res.body.data.total_receipts_today).toBe(12);
      expect(receiptService.getReceiptStats).toHaveBeenCalledWith('org_test_123');
    });
  });

  describe('GET /api/logistics/receipts/:id (Multi-tenant Isolation)', () => {
    it("doit refuser l'accès (403) si la réception appartient à une autre organisation", async () => {
      // Pour ce test, pas de mocking du service car le middleware doit bloquer AVANT
      // Mais on doit quand même mocker prisma car le middleware l'utilise
      const { prisma } = await import('../../../../shared/configs/prismaClient.config');
      vi.mocked(prisma.receipt.findFirst).mockResolvedValue(null); // Pas trouvé dans NOTRE org

      const res = await request(app).get('/api/logistics/receipts/rcpt-1');

      expect(res.status).toBe(404); // Le middleware renvoie 404 si pas trouvé dans l'org
      expect(res.body.error[0].message).toContain('introuvable dans votre organisation');
    });

    it("doit aussi refuser l'accès (404) en mode M2M (x-api-key) — pas de bypass tenant", async () => {
      const { prisma } = await import('../../../../shared/configs/prismaClient.config');
      vi.mocked(prisma.receipt.findFirst).mockResolvedValue(null);

      const res = await request(app)
        .get('/api/logistics/receipts/rcpt-1')
        .set('x-api-key', 'any-key');

      expect(res.status).toBe(404);
      expect(res.body.error[0].message).toContain('introuvable dans votre organisation');
      expect(prisma.receipt.findFirst).toHaveBeenCalled();
    });

    it("doit aussi refuser l'accès (404) sur un batch en mode M2M (x-api-key) — pas de bypass tenant", async () => {
      const { prisma } = await import('../../../../shared/configs/prismaClient.config');
      vi.mocked(prisma.batch.findFirst).mockResolvedValue(null);

      const res = await request(app)
        .get('/api/logistics/batches/batch-1')
        .set('x-api-key', 'any-key');

      expect(res.status).toBe(404);
      expect(res.body.error[0].message).toContain('introuvable dans votre organisation');
      expect(prisma.batch.findFirst).toHaveBeenCalled();
    });

    it("doit autoriser l'accès (200) si la réception appartient à la même organisation", async () => {
      const { prisma } = await import('../../../../shared/configs/prismaClient.config');
      vi.mocked(prisma.receipt.findFirst).mockResolvedValue({
        id: 'rcpt-1',
        organization_id: 'org_test_123',
        shipment_id: 'SHIP-123',
        date_reception: new Date(),
        statut_controle: 'OK',
        id_fournisseur: 'f-1',
        received_by: 'u-1',
        temperature_camion_raw: null,
        temperature_camion_summary: null,
      } as Receipt);

      vi.mocked(receiptService.getReceiptById).mockResolvedValue({
        id: 'rcpt-1',
        organization_id: 'org_test_123',
        id_fournisseur: 'f-1',
        shipment_id: 'SHIP-123',
        date_reception: new Date(),
        statut_controle: 'OK',
        received_by: 'u-1',
        temperature_camion_raw: null,
        temperature_camion_summary: null,
        fournisseur: {
          id: 'f-1',
          nom_ferme: 'Ferme Test',
          adresse_siege: '123 Rue de la Ferme',
          type_produit: 'Légumes',
          contact_qualite: 'Jean Dupont',
        },
      } as unknown as ReceiptWithSupplier);

      const res = await request(app).get('/api/logistics/receipts/rcpt-1');

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe('rcpt-1');
      expect(receiptService.getReceiptById).toHaveBeenCalledWith('rcpt-1', 'org_test_123');
    });
  });

  describe('POST /api/logistics/batches/:id/release (levée de quarantaine)', () => {
    // Un lot accessible dans l'org : nécessaire pour passer verifyBatchAccess
    const mockBatchInOrg = async () => {
      const { prisma } = await import('../../../../shared/configs/prismaClient.config');
      vi.mocked(prisma.batch.findFirst).mockResolvedValue({
        id: 'batch-1',
        organization_id: 'org_test_123',
        statut: 'BLOQUE',
      } as unknown as never);
    };

    it('doit lever la quarantaine et retourner 200 avec un motif valide', async () => {
      await mockBatchInOrg();
      vi.mocked(batchService.liftQuarantine).mockResolvedValue({
        id: 'batch-1',
        statut: 'EN_STOCK',
      } as never);

      const res = await request(app)
        .post('/api/logistics/batches/batch-1/release')
        .send({ motif: 'Nouveau contrôle qualité conforme' });

      expect(res.status).toBe(200);
      expect(res.body.data.statut).toBe('EN_STOCK');
      expect(batchService.liftQuarantine).toHaveBeenCalledWith(
        'batch-1',
        'org_test_123',
        'u-123',
        'Nouveau contrôle qualité conforme'
      );
    });

    it('doit refuser (400) si le motif est absent ou trop court', async () => {
      await mockBatchInOrg();

      const res = await request(app)
        .post('/api/logistics/batches/batch-1/release')
        .send({ motif: 'x' });

      expect(res.status).toBe(400);
      expect(batchService.liftQuarantine).not.toHaveBeenCalled();
    });

    it('doit refuser (404) un lot hors de l organisation (verifyBatchAccess)', async () => {
      const { prisma } = await import('../../../../shared/configs/prismaClient.config');
      vi.mocked(prisma.batch.findFirst).mockResolvedValue(null);

      const res = await request(app)
        .post('/api/logistics/batches/autre-org/release')
        .send({ motif: 'Tentative cross-tenant' });

      expect(res.status).toBe(404);
      expect(batchService.liftQuarantine).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/logistics/batches/:id/scrap (mise au rebut)', () => {
    const mockBatchInOrg = async (statut = 'BLOQUE') => {
      const { prisma } = await import('../../../../shared/configs/prismaClient.config');
      vi.mocked(prisma.batch.findFirst).mockResolvedValue({
        id: 'batch-1',
        organization_id: 'org_test_123',
        statut,
      } as unknown as never);
    };

    it('doit mettre le lot au rebut et retourner 200 avec un motif valide', async () => {
      await mockBatchInOrg();
      vi.mocked(batchService.scrapBatch).mockResolvedValue({
        id: 'batch-1',
        statut: 'REBUT',
      } as never);

      const res = await request(app)
        .post('/api/logistics/batches/batch-1/scrap')
        .send({ motif: 'Lot rappelé, destruction confirmée' });

      expect(res.status).toBe(200);
      expect(res.body.data.statut).toBe('REBUT');
      expect(batchService.scrapBatch).toHaveBeenCalledWith(
        'batch-1',
        'org_test_123',
        'u-123',
        'Lot rappelé, destruction confirmée'
      );
    });

    it('doit refuser (400) si le motif est absent ou trop court', async () => {
      await mockBatchInOrg();

      const res = await request(app)
        .post('/api/logistics/batches/batch-1/scrap')
        .send({ motif: 'x' });

      expect(res.status).toBe(400);
      expect(batchService.scrapBatch).not.toHaveBeenCalled();
    });

    it('doit refuser (404) un lot hors de l organisation (verifyBatchAccess)', async () => {
      const { prisma } = await import('../../../../shared/configs/prismaClient.config');
      vi.mocked(prisma.batch.findFirst).mockResolvedValue(null);

      const res = await request(app)
        .post('/api/logistics/batches/autre-org/scrap')
        .send({ motif: 'Tentative cross-tenant' });

      expect(res.status).toBe(404);
      expect(batchService.scrapBatch).not.toHaveBeenCalled();
    });
  });

  /**
   * ⚠️ Ces cas verrouillent le CÂBLAGE de la borne, pas le schéma. Un test de schéma isolé reste
   * vert si l'on retire le middleware de la route — et c'est exactement ainsi que ces deux
   * endpoints s'étaient retrouvés sans plafond alors que tous les autres en avaient un.
   */
  describe('GET /api/logistics/receipts — bornes de pagination', () => {
    it('refuse une limite démesurée en 400, au lieu de charger toutes les réceptions', async () => {
      const res = await request(app).get('/api/logistics/receipts?limit=100000000');

      expect(res.status).toBe(400);
      expect(receiptService.listReceipts).not.toHaveBeenCalled();
    });

    it("refuse une limite non numérique en 400, au lieu d'un `take: NaN` (500)", async () => {
      const res = await request(app).get('/api/logistics/receipts?limit=abc');

      expect(res.status).toBe(400);
    });

    it('refuse une page nulle en 400, au lieu d’un `skip` négatif (500)', async () => {
      const res = await request(app).get('/api/logistics/receipts?page=0');

      expect(res.status).toBe(400);
    });

    it('laisse passer une requête normale, avec ses valeurs par défaut', async () => {
      vi.mocked(receiptService.listReceipts).mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 20 },
      } as never);

      const res = await request(app).get('/api/logistics/receipts');

      expect(res.status).toBe(200);
      expect(receiptService.listReceipts).toHaveBeenCalledWith('org_test_123', 1, 20);
    });
  });
});
