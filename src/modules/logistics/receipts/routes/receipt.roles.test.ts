import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const getSession = vi.fn();
const getFullOrganization = vi.fn();

// On exerce le VRAI mixedAuth/requireOrgRole : c'est la liste des rôles autorisés
// (WRITE_ROLES / QUALITY_ROLES) qu'on teste. Les autres tests de ces routes mockent
// mixedAuth et ne détecteraient donc aucune régression RBAC — d'où ce fichier dédié.
vi.mock('../../../identity/auth.config', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSession(...args),
      getFullOrganization: (...args: unknown[]) => getFullOrganization(...args),
    },
  },
}));

// Contrôleurs et middlewares en aval mockés : on isole la garde de rôle.
vi.mock('../controllers/receipt.controller', () => ({
  createReceiptController: (_req: express.Request, res: express.Response) => res.status(200).end(),
  getReceiptStatsController: (_req: express.Request, res: express.Response) =>
    res.status(200).end(),
  getReceiptByIdController: (_req: express.Request, res: express.Response) => res.status(200).end(),
  getBatchByIdController: (_req: express.Request, res: express.Response) => res.status(200).end(),
  getBatchLabelController: (_req: express.Request, res: express.Response) => res.status(200).end(),
  listReceiptsController: (_req: express.Request, res: express.Response) => res.status(200).end(),
  liftBatchQuarantineController: (_req: express.Request, res: express.Response) =>
    res.status(200).end(),
}));
vi.mock('../middlewares/validateReceipt.middleware', () => ({
  validateReceiptParams: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
}));
vi.mock('../middlewares/validateQuarantineLift.middleware', () => ({
  validateQuarantineLift: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
}));
vi.mock('../../middlewares/verifyReceiptAccess.middleware', () => ({
  verifyReceiptAccess: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
}));
vi.mock('../../middlewares/verifyBatchAccess.middleware', () => ({
  verifyBatchAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));

const { default: receiptRoutes } = await import('./receipt.routes');
const { globalErrorHandler } = await import('../../../../shared/utils/errorHandler/errorHandler');

const app = express();
app.use(express.json());
app.use('/api', receiptRoutes);
app.use(globalErrorHandler);

function signedInAs(role: string): void {
  getSession.mockResolvedValue({
    user: { id: 'u-1' },
    session: { activeOrganizationId: 'org-1' },
  });
  getFullOrganization.mockResolvedValue({ id: 'org-1', members: [{ userId: 'u-1', role }] });
}

beforeEach(() => vi.clearAllMocks());

describe('RBAC des routes logistiques (session réelle)', () => {
  describe('POST /logistics/receipts (écriture métier)', () => {
    it.each(['owner', 'admin', 'operator'])('autorise %s', async (role) => {
      signedInAs(role);
      const res = await request(app).post('/api/logistics/receipts').send({});
      expect(res.status).toBe(200);
    });

    it('refuse viewer (lecture seule)', async () => {
      signedInAs('viewer');
      const res = await request(app).post('/api/logistics/receipts').send({});
      expect(res.status).toBe(403);
    });
  });

  describe('POST /logistics/batches/:id/release (décision qualité)', () => {
    it.each(['owner', 'admin', 'quality'])('autorise %s', async (role) => {
      signedInAs(role);
      const res = await request(app).post('/api/logistics/batches/lot-1/release').send({});
      expect(res.status).toBe(200);
    });

    it('refuse operator — séparation des tâches HACCP (il réceptionne, il ne lève pas)', async () => {
      signedInAs('operator');
      const res = await request(app).post('/api/logistics/batches/lot-1/release').send({});
      expect(res.status).toBe(403);
    });

    it('refuse viewer', async () => {
      signedInAs('viewer');
      const res = await request(app).post('/api/logistics/batches/lot-1/release').send({});
      expect(res.status).toBe(403);
    });
  });

  it('refuse un rôle inconnu', async () => {
    signedInAs('stagiaire_curieux');
    const res = await request(app).post('/api/logistics/receipts').send({});
    expect(res.status).toBe(403);
  });
});
