import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { globalErrorHandler } from '../../../shared/utils/errorHandler/errorHandler';
import { AuthenticatedRequest } from '../../identity/types/auth.types';

const sessionAuthMock = vi.fn();

vi.mock('../../../shared/middlewares/sessionAuth', () => ({
  sessionAuth: () => (req: express.Request, res: express.Response, next: express.NextFunction) =>
    sessionAuthMock(req, res, next),
}));

// Le service est simulé : ce fichier teste le CONTRAT de la route (validation du couple de
// coordonnées avant écriture). La cohérence face à l'état en base est testée sur le service.
vi.mock('../services/location.service', () => ({
  locationService: {
    create: vi.fn().mockResolvedValue({ id: 'loc-1' }),
    update: vi.fn().mockResolvedValue({ id: 'loc-1' }),
    setActive: vi.fn().mockResolvedValue({ id: 'loc-1', is_active: true }),
  },
}));

import organizationRouter from './organization.routes';
import { locationService } from '../services/location.service';

const app = express();
app.use(express.json());
app.use('/api', organizationRouter);
app.use(globalErrorHandler);

const LOC_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  sessionAuthMock.mockImplementation((req: AuthenticatedRequest, _res, next) => {
    req.activeOrgId = 'org-1';
    req.auth = { role: 'admin', user: { id: 'u-1' } } as AuthenticatedRequest['auth'];
    next();
  });
});

describe('POST /api/organization/locations — position du lieu', () => {
  it('crée un lieu positionné et transmet les coordonnées en nombres', async () => {
    const res = await request(app).post('/api/organization/locations').send({
      nom: 'Quai de réception',
      type: 'RECEPTION',
      latitude: 48.83291,
      longitude: 2.28654,
    });

    expect(res.status).toBe(201);
    expect(locationService.create).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: 48.83291, longitude: 2.28654 }),
      'org-1',
      'u-1'
    );
  });

  it('accepte un lieu sans position : la carte de la fiche lot est facultative', async () => {
    const res = await request(app)
      .post('/api/organization/locations')
      .send({ nom: 'Quai de réception', type: 'RECEPTION' });

    expect(res.status).toBe(201);
    expect(locationService.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ latitude: expect.anything() }),
      'org-1',
      'u-1'
    );
  });

  // `type` est un simple label facultatif : on peut créer un emplacement sans le renseigner.
  it('accepte un lieu sans type', async () => {
    const res = await request(app)
      .post('/api/organization/locations')
      .send({ nom: 'Zone de transit' });

    expect(res.status).toBe(201);
    expect(locationService.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ type: expect.anything() }),
      'org-1',
      'u-1'
    );
  });

  it('refuse une latitude seule : une demi-position ne place aucun repère', async () => {
    const res = await request(app)
      .post('/api/organization/locations')
      .send({ nom: 'Quai de réception', type: 'RECEPTION', latitude: 48.83291 });

    expect(res.status).toBe(400);
    expect(locationService.create).not.toHaveBeenCalled();
  });

  it('refuse une longitude seule, symétriquement', async () => {
    const res = await request(app)
      .post('/api/organization/locations')
      .send({ nom: 'Quai de réception', type: 'RECEPTION', longitude: 2.28654 });

    expect(res.status).toBe(400);
    expect(locationService.create).not.toHaveBeenCalled();
  });

  it('refuse une latitude hors du domaine terrestre (lat/lng permutées)', async () => {
    const res = await request(app)
      .post('/api/organization/locations')
      .send({ nom: 'Quai de réception', type: 'RECEPTION', latitude: 122.4, longitude: 37.77 });

    expect(res.status).toBe(400);
    expect(locationService.create).not.toHaveBeenCalled();
  });

  it('refuse une longitude hors bornes', async () => {
    const res = await request(app)
      .post('/api/organization/locations')
      .send({ nom: 'Quai de réception', type: 'RECEPTION', latitude: 48.83291, longitude: 361 });

    expect(res.status).toBe(400);
    expect(locationService.create).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/organization/locations/:id — position du lieu', () => {
  it('positionne un lieu existant', async () => {
    const res = await request(app)
      .patch(`/api/organization/locations/${LOC_ID}`)
      .send({ latitude: 48.83318, longitude: 2.28691 });

    expect(res.status).toBe(200);
    expect(locationService.update).toHaveBeenCalledWith(
      LOC_ID,
      { latitude: 48.83318, longitude: 2.28691 },
      'org-1',
      'u-1'
    );
  });

  it('efface la position avec les deux coordonnées à null', async () => {
    const res = await request(app)
      .patch(`/api/organization/locations/${LOC_ID}`)
      .send({ latitude: null, longitude: null });

    expect(res.status).toBe(200);
    expect(locationService.update).toHaveBeenCalledWith(
      LOC_ID,
      { latitude: null, longitude: null },
      'org-1',
      'u-1'
    );
  });

  it('refuse de ne modifier que la latitude', async () => {
    const res = await request(app)
      .patch(`/api/organization/locations/${LOC_ID}`)
      .send({ latitude: 48.83318 });

    expect(res.status).toBe(400);
    expect(locationService.update).not.toHaveBeenCalled();
  });
});
