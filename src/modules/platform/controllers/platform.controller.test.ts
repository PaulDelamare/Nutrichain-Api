import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import { createOrganizationController, inviteOwnerController } from './platform.controller';
import { validateCreateOrganization, validateInviteOwner } from '../middlewares/platform.schema';
import { platformService } from '../services/platform.service';
import type { AuthenticatedRequest } from '../../identity/types/auth.types';

vi.mock('../services/platform.service', () => ({
  platformService: {
    createOrganization: vi.fn(),
    inviteOwner: vi.fn(),
  },
}));

const buildRes = () => {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const buildReq = (body: unknown): AuthenticatedRequest =>
  ({
    body,
    params: {},
    auth: { user: { id: 'admin-1', email: 'platform@nutrichain.local' } },
  }) as unknown as AuthenticatedRequest;

// La garde de la route (checkApiKey + requirePlatformAdmin) pose `req.auth`. On teste la chaîne
// validation → contrôleur → service telle que la route la câble : le middleware VineJS valide ET
// transforme (trim, toLowerCase), le contrôleur transmet au service ce que le middleware a produit.
describe('platform — validation transmise au service (câblage réel)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(platformService.createOrganization).mockResolvedValue({ id: 'org-1' } as never);
    vi.mocked(platformService.inviteOwner).mockResolvedValue({} as never);
  });

  it('normalise le slug en minuscules avant de le transmettre au service', async () => {
    const req = buildReq({ name: 'Ferme Test', slug: 'MAJUSCULE-VALIDE' });
    const next = vi.fn();

    await validateCreateOrganization(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith(); // validation OK, pas d'erreur
    await createOrganizationController(req, buildRes(), vi.fn());

    // Le service ne doit JAMAIS recevoir la casse brute : un slug identifie l'org dans les URLs et
    // les identifiants, il doit être canonique. Sans normalisation, `Ferme-A` et `ferme-a` créent
    // deux orgs distinctes que l'unicité de slug est censée empêcher.
    expect(platformService.createOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'majuscule-valide' }),
      'admin-1'
    );
  });

  it('applique le trim au nom et au slug transmis au service', async () => {
    const req = buildReq({ name: '  Ferme Espaces  ', slug: '  ferme-espaces  ' });
    await validateCreateOrganization(req, buildRes(), vi.fn());
    await createOrganizationController(req, buildRes(), vi.fn());

    expect(platformService.createOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Ferme Espaces', slug: 'ferme-espaces' }),
      'admin-1'
    );
  });

  it('rejette un slug avec underscore en 400 sans appeler le service', async () => {
    const req = buildReq({ name: 'Ferme Test', slug: 'avec_underscore' });
    const next = vi.fn();

    // `catchAsync` ne lève pas : il route l'erreur vers `next(err)`.
    await validateCreateOrganization(req, buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
    const err = next.mock.calls[0][0] as { error: { field: string }[] };
    expect(err.error[0].field).toBe('slug');
    expect(platformService.createOrganization).not.toHaveBeenCalled();
  });

  it("transmet l'email validé (trim) au service d'invitation", async () => {
    const req = buildReq({ email: 'owner@ferme.fr' });
    req.params = { id: 'org-1' };
    await validateInviteOwner(req, buildRes(), vi.fn());
    await inviteOwnerController(req, buildRes(), vi.fn());

    expect(platformService.inviteOwner).toHaveBeenCalledWith(
      'org-1',
      'owner@ferme.fr',
      expect.objectContaining({ id: 'admin-1' })
    );
  });
});
