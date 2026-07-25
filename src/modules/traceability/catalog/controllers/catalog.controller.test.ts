import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Response } from 'express';
import { getProducts, getBatches } from './catalog.controller';
import { catalogService } from '../services/catalog.service';
import { AuthenticatedRequest } from '../../../identity/middlewares/requireAuth.middleware';
import { ROLES } from '../../../identity/constants/roles.constants';

vi.mock('../services/catalog.service', () => ({
  catalogService: {
    getAllProducts: vi.fn(),
    getAllBatches: vi.fn(),
  },
}));

// sendSuccess est mocké : ces tests portent sur les ARGUMENTS que le contrôleur calcule et
// transmet au service (pas sur le corps HTTP), donc un `res` vide suffit.
vi.mock('../../../../shared/utils/returnSuccess/returnSuccess', () => ({
  sendSuccess: vi.fn(),
}));

// Forme de `req` FIDÈLE à la production : sur ces routes, `requireOrgRole` (après `requireAuth`)
// pose `req.auth.role`, `req.auth.activeOrgId` ET `req.activeOrgId`. C'est ce que le contrôleur lit.
const buildRequest = (
  role: string | undefined,
  query: Record<string, string | number> = {},
  orgId: string | undefined = 'org-1'
): AuthenticatedRequest =>
  ({
    activeOrgId: orgId,
    auth: role === undefined ? undefined : { role, activeOrgId: orgId },
    query,
    // `validateCatalogQuery` a déjà coercé `page`/`limit` en nombres quand ils sont fournis.
    validatedCatalogQuery: {
      q: query.q,
      ...(query.page === undefined ? {} : { page: Number(query.page) }),
      ...(query.limit === undefined ? {} : { limit: Number(query.limit) }),
    },
  }) as unknown as AuthenticatedRequest;

describe('catalog.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `clearAllMocks` n'efface pas les implémentations : on repose le défaut à chaque test.
    vi.mocked(catalogService.getAllProducts).mockResolvedValue([] as never);
    vi.mocked(catalogService.getAllBatches).mockResolvedValue([] as never);
  });

  describe('getProducts — includeArchived réservé à l administration', () => {
    it('transmet includeArchived=false pour un viewer, MÊME avec ?includeArchived=true', async () => {
      // Rôle le plus faible qui atteint la route (CATALOG_READ_ROLES = tous les rôles) : lister les
      // archivés est un usage d'administration (réactiver), un viewer ne doit pas les énumérer.
      const req = buildRequest(ROLES.VIEWER, { includeArchived: 'true' });

      await getProducts(req, {} as Response);

      expect(catalogService.getAllProducts).toHaveBeenCalledWith('org-1', false);
    });

    it('transmet includeArchived=true pour un admin qui demande ?includeArchived=true', async () => {
      const req = buildRequest(ROLES.ADMIN, { includeArchived: 'true' });

      await getProducts(req, {} as Response);

      expect(catalogService.getAllProducts).toHaveBeenCalledWith('org-1', true);
    });

    it('transmet includeArchived=false pour un admin qui ne demande pas le paramètre', async () => {
      // Le rôle admin ne suffit pas : sans `?includeArchived=true`, on n'énumère pas les archivés.
      const req = buildRequest(ROLES.ADMIN, {});

      await getProducts(req, {} as Response);

      expect(catalogService.getAllProducts).toHaveBeenCalledWith('org-1', false);
    });

    // Fixe la BORNE de la garde, pas seulement ses extrêmes. `quality` et `operator` atteignent la
    // route (lecture catalogue ouverte à tous) mais ne sont PAS dans ADMIN_ROLES : élargir la garde
    // à l'un d'eux (ex. ADMIN_ROLES → QUALITY_ROLES) doit rougir ici, pas passer inaperçu.
    it.each([ROLES.QUALITY, ROLES.OPERATOR])(
      'transmet includeArchived=false pour le rôle %s (non-admin), MÊME avec ?includeArchived=true',
      async (role) => {
        const req = buildRequest(role, { includeArchived: 'true' });

        await getProducts(req, {} as Response);

        expect(catalogService.getAllProducts).toHaveBeenCalledWith('org-1', false);
      }
    );
  });

  describe('getBatches — revealAuthor réservé à l administration', () => {
    it("transmet revealAuthor=false pour un viewer : l'auteur d'un lot est une donnée réservée", async () => {
      const req = buildRequest(ROLES.VIEWER, { q: 'lait' });

      await getBatches(req, {} as Response);

      expect(catalogService.getAllBatches).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ search: 'lait', revealAuthor: false })
      );
    });

    it('transmet revealAuthor=true pour un admin', async () => {
      const req = buildRequest(ROLES.ADMIN, { q: 'lait' });

      await getBatches(req, {} as Response);

      expect(catalogService.getAllBatches).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ search: 'lait', revealAuthor: true })
      );
    });

    // Même borne que pour getProducts : `quality` et `operator` ne doivent pas voir l'auteur d'un lot.
    it.each([ROLES.QUALITY, ROLES.OPERATOR])(
      'transmet revealAuthor=false pour le rôle %s (non-admin)',
      async (role) => {
        const req = buildRequest(role, { q: 'lait' });

        await getBatches(req, {} as Response);

        expect(catalogService.getAllBatches).toHaveBeenCalledWith(
          'org-1',
          expect.objectContaining({ revealAuthor: false })
        );
      }
    );
  });

  describe('getBatches — pagination', () => {
    it('transmet la page et la taille de page demandées', async () => {
      const req = buildRequest(ROLES.VIEWER, { page: 3, limit: 50 });

      await getBatches(req, {} as Response);

      expect(catalogService.getAllBatches).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ page: 3, limit: 50 })
      );
    });

    /**
     * Le défaut reproduit l'ancien `take: 100` : un appelant qui ne pagine pas encore (sélecteurs de
     * lot, tableau de bord) doit recevoir le même volume qu'avant, pas les 20 par défaut des autres
     * lectures paginées.
     */
    it('retombe sur la première page de 100 lots quand rien n est demandé', async () => {
      const req = buildRequest(ROLES.VIEWER, {});

      await getBatches(req, {} as Response);

      expect(catalogService.getAllBatches).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ page: 1, limit: 100 })
      );
    });
  });

  describe('garde défensive : organisation active absente', () => {
    // En production `requireOrgRole` garantit l'organisation avant le contrôleur ; cette garde est
    // le filet si ce câblage disparaissait. `where: { organization_id: undefined }` ne filtrant RIEN
    // côté Prisma (il servirait tous les tenants), le contrôleur DOIT rejeter plutôt qu'appeler le
    // service avec `undefined`.
    it('getProducts rejette en 400 sans appeler le service quand aucune organisation n est posée', async () => {
      // `requireAuth` pose toujours un `req.auth`, mais `activeOrgId` reste absent quand aucune org
      // n'est sélectionnée dans la session : c'est cet état dégradé, pas un `req.auth` inexistant.
      const req = {
        activeOrgId: undefined,
        auth: { activeOrgId: undefined },
        query: {},
      } as unknown as AuthenticatedRequest;

      await expect(getProducts(req, {} as Response)).rejects.toMatchObject({ status: 400 });
      expect(catalogService.getAllProducts).not.toHaveBeenCalled();
    });

    it('getBatches rejette en 400 sans appeler le service quand aucune organisation n est posée', async () => {
      const req = {
        activeOrgId: undefined,
        auth: { activeOrgId: undefined },
        query: {},
        validatedCatalogQuery: { q: 'lait' },
      } as unknown as AuthenticatedRequest;

      await expect(getBatches(req, {} as Response)).rejects.toMatchObject({ status: 400 });
      expect(catalogService.getAllBatches).not.toHaveBeenCalled();
    });
  });
});
