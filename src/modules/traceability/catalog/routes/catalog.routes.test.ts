import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import catalogRoutes from './catalog.routes';
import { catalogService } from '../services/catalog.service';

// Mock du service
vi.mock('../services/catalog.service', () => ({
  catalogService: {
    getAllProducts: vi.fn(),
    getAllBatches: vi.fn(),
  },
}));

// Mock du middleware checkApiKey
vi.mock('../../../../shared/utils/checkApiKey/checkApiKey', () => ({
  checkApiKey: vi.fn(
    () => (req: express.Request, res: express.Response, next: express.NextFunction) => next()
  ),
}));

// Mock des middlewares d'authentification
vi.mock('../../../identity/middlewares/requireAuth.middleware', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock('../../../identity/middlewares/requireOrgRole.middleware', () => ({
  requireOrgRole: () => (req: express.Request, res: express.Response, next: express.NextFunction) =>
    next(),
}));

describe('Catalog Routes Integration', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api', catalogRoutes);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/traceability/products', () => {
    it('doit retourner une liste de produits avec un statut 200', async () => {
      const mockProducts = [
        { id: '1', nom: 'Produit A' },
        { id: '2', nom: 'Produit B' },
      ];

      vi.mocked(catalogService.getAllProducts).mockResolvedValue(mockProducts as unknown[]);

      const res = await request(app).get('/api/traceability/products');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Produits récupérés avec succès');
      expect(res.body.data).toEqual(mockProducts);
      expect(catalogService.getAllProducts).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /api/traceability/batches', () => {
    it('doit retourner une liste de lots avec un statut 200', async () => {
      const mockBatches = [{ id: '1', id_produit: 'p1', quantite_actuelle: 100 }];

      vi.mocked(catalogService.getAllBatches).mockResolvedValue(mockBatches as unknown[]);

      const res = await request(app).get('/api/traceability/batches');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Lots récupérés avec succès');
      expect(res.body.data).toEqual(mockBatches);
      expect(catalogService.getAllBatches).toHaveBeenCalledTimes(1);
    });
  });
});
