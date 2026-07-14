import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { Alert, Prisma } from '@prisma/client';
import { globalErrorHandler } from '../../../shared/utils/errorHandler/errorHandler';
import { AuthenticatedRequest, AuthUser, AuthSession } from '../../identity/types/auth.types';

// Mocks injectés avant l'import du router (vi.mock est hoisted)
const authState: {
  authenticated: boolean;
  rolePass: boolean;
  alert: Alert | null;
} = {
  authenticated: true,
  rolePass: true,
  alert: null,
};

vi.mock('../../identity/middlewares/requireAuth.middleware', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    if (!authState.authenticated) {
      return next({
        status: 401,
        error: [{ field: 'auth', message: 'Accès refusé.' }],
      });
    }
    (req as AuthenticatedRequest).auth = {
      user: { id: 'user-admin' } as unknown as AuthUser,
      session: { id: 'sess-1', activeOrganizationId: 'org-1' } as unknown as AuthSession,
      activeOrgId: 'org-1',
    };
    (req as AuthenticatedRequest).activeOrgId = 'org-1';
    next();
  },
}));

vi.mock('../../identity/middlewares/requireOrgRole.middleware', () => ({
  requireOrgRole: () => (req: Request, _res: Response, next: NextFunction) => {
    if (!authState.rolePass) {
      return next({
        status: 403,
        error: [{ field: 'auth', message: 'Rôle insuffisant.' }],
      });
    }
    next();
  },
}));

// Mock du verifyAlertAccess pour piloter l'alert depuis le test
vi.mock('../middlewares/verifyAlertAccess.middleware', () => ({
  verifyAlertAccess: async (req: Request, _res: Response, next: NextFunction) => {
    // Note: on importe la constante dynamiquement pour respecter le hoisting de vi.mock.
    const { ALERT_NOT_FOUND_MSG: msg } = await import('../constants/alert.constants');
    if (!authState.alert) {
      return next({
        status: 404,
        error: [{ field: 'alert', message: msg }],
      });
    }
    (req as AuthenticatedRequest).alert = authState.alert;
    next();
  },
}));

// Mock service pour piloter le résultat
vi.mock('../services/alert.service', () => ({
  alertService: { resolveAlert: vi.fn() },
}));

vi.mock('../services/alertBatch.service', () => ({
  alertBatchService: { listBatchesIsolatedByAlert: vi.fn() },
}));

import alertRouter from './alert.routes';
import { alertService } from '../services/alert.service';
import { alertBatchService } from '../services/alertBatch.service';
import { ALERT_NOT_FOUND_MSG } from '../constants/alert.constants';

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
    resolved_by: 'user-admin',
    resolved_at: new Date(),
    ...overrides,
  }) as Alert;

describe('Alert Routes Integration', () => {
  const app = express();
  app.use(express.json());
  app.use('/api', alertRouter);
  app.use(globalErrorHandler);

  beforeEach(() => {
    vi.clearAllMocks();
    authState.authenticated = true;
    authState.rolePass = true;
    authState.alert = buildAlert();
  });

  it('1. 200 happy path TEMP_EXCURSION', async () => {
    const resolved = buildAlert();
    vi.mocked(alertService.resolveAlert).mockResolvedValue({
      alert: resolved,
      alreadyResolved: false,
    });

    const res = await request(app).patch('/api/alerts/alert-1/resolve').send({});

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('résolue avec succès');
    expect(res.body.message).not.toContain('rappel produit');
  });

  it('2. 200 happy path PRODUCT_RECALL → message contient warning Recall', async () => {
    const recall = buildAlert({ type: 'PRODUCT_RECALL' });
    authState.alert = recall;
    vi.mocked(alertService.resolveAlert).mockResolvedValue({
      alert: recall,
      alreadyResolved: false,
    });

    const res = await request(app).patch('/api/alerts/alert-1/resolve').send({});

    expect(res.status).toBe(200);
    expect(res.body.message).toContain("rappel produit lui-même n'est pas clôturé");
  });

  it('3. 401 sans session', async () => {
    authState.authenticated = false;

    const res = await request(app).patch('/api/alerts/alert-1/resolve').send({});

    expect(res.status).toBe(401);
  });

  it('4. 403 rôle insuffisant', async () => {
    authState.rolePass = false;

    const res = await request(app).patch('/api/alerts/alert-1/resolve').send({});

    expect(res.status).toBe(403);
  });

  it('5. 404 cross-org / alerte introuvable', async () => {
    authState.alert = null;

    const res = await request(app).patch('/api/alerts/alert-1/resolve').send({});

    expect(res.status).toBe(404);
    expect(res.body.error[0].message).toBe(ALERT_NOT_FOUND_MSG);
  });

  it("6. 200 idempotent → message contient 'idempotent'", async () => {
    const resolved = buildAlert();
    vi.mocked(alertService.resolveAlert).mockResolvedValue({
      alert: resolved,
      alreadyResolved: true,
    });

    const res = await request(app).patch('/api/alerts/alert-1/resolve').send({});

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('idempotent');
  });

  it('7. 400 si note > 500 chars', async () => {
    const res = await request(app)
      .patch('/api/alerts/alert-1/resolve')
      .send({ note: 'a'.repeat(501) });

    expect(res.status).toBe(400);
    expect(res.body.error[0].field).toBe('note');
  });
});

describe('GET /api/alerts/:id/batches', () => {
  const app = express();
  app.use(express.json());
  app.use('/api', alertRouter);
  app.use(globalErrorHandler);

  beforeEach(() => {
    vi.clearAllMocks();
    authState.authenticated = true;
    authState.rolePass = true;
    authState.alert = buildAlert();
  });

  it('200 : renvoie les lots isolés par CETTE alerte, avec leur caractère levable', async () => {
    vi.mocked(alertBatchService.listBatchesIsolatedByAlert).mockResolvedValue([
      {
        id: 'lot-a',
        lot_number: 'LOT-A',
        quantite_actuelle: new Prisma.Decimal('3'),
        unite_code: 'KGM',
        produit: { nom: 'Saumon' },
        levable: true,
        motif_blocage: null,
      },
    ]);

    const res = await request(app).get('/api/alerts/alert-1/batches');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: 'lot-a', levable: true, motif_blocage: null });
    // L'alerte transmise au service est celle que verifyAlertAccess a scopée à l'organisation.
    expect(alertBatchService.listBatchesIsolatedByAlert).toHaveBeenCalledWith(authState.alert);
  });

  it('200 : une alerte sans lot isolé renvoie une liste vide (pas une erreur)', async () => {
    vi.mocked(alertBatchService.listBatchesIsolatedByAlert).mockResolvedValue([]);

    const res = await request(app).get('/api/alerts/alert-1/batches');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('401 sans session', async () => {
    authState.authenticated = false;

    expect((await request(app).get('/api/alerts/alert-1/batches')).status).toBe(401);
  });

  it("404 cross-org : on n'expose pas les lots d'une alerte d'une autre organisation", async () => {
    authState.alert = null;

    const res = await request(app).get('/api/alerts/alert-1/batches');

    expect(res.status).toBe(404);
    expect(res.body.error[0].message).toBe(ALERT_NOT_FOUND_MSG);
    expect(alertBatchService.listBatchesIsolatedByAlert).not.toHaveBeenCalled();
  });
});
