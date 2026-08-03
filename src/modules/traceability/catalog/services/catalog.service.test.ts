import { describe, it, expect, vi, beforeEach } from 'vitest';
import { catalogService } from './catalog.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    product: { findMany: vi.fn(), count: vi.fn() },
    batch: { findMany: vi.fn(), count: vi.fn() },
    // `$transaction` reçoit les PROMESSES déjà créées par les mocks ci-dessus : les résoudre dans
    // l'ordre reproduit le comportement de Prisma sans avoir à simuler une transaction.
    $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
  },
}));

/** Pose un total et une page de résultats pour le couple `count` + `findMany` de `getAllBatches`. */
const mockBatchPage = (total: number, rows: unknown[] = []) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(prisma.batch.count).mockResolvedValue(total as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(prisma.batch.findMany).mockResolvedValue(rows as any);
};

describe('CatalogService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAllProducts', () => {
    it('doit lister les produits cloisonnés par organisation, triés par nom', async () => {
      const products = [{ id: 'prod-1', nom: 'Beurre' }];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.product.findMany).mockResolvedValue(products as any);

      const result = await catalogService.getAllProducts('org-1');

      expect(prisma.product.findMany).toHaveBeenCalledWith({
        where: { organization_id: 'org-1', is_active: true },
        orderBy: { nom: 'asc' },
      });
      expect(result).toBe(products);
    });
  });

  describe('getProductsPaginated', () => {
    /** Pose un total et une page de résultats pour le couple `count` + `findMany`. */
    const mockProductPage = (total: number, rows: unknown[] = []) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.product.count).mockResolvedValue(total as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.product.findMany).mockResolvedValue(rows as any);
    };

    it('pagine (skip/take), trié par nom, renvoie { data, pagination }', async () => {
      mockProductPage(42, [{ id: 'prod-1' }]);

      const result = await catalogService.getProductsPaginated('org-1', { page: 3, limit: 10 });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { nom: 'asc' }, skip: 20, take: 10 })
      );
      expect(result.pagination).toEqual({ page: 3, limit: 10, total: 42, totalPages: 5 });
      expect(result.data).toEqual([{ id: 'prod-1' }]);
    });

    it('filtre nom (contains insensible) et statut archive (administration)', async () => {
      mockProductPage(0);

      await catalogService.getProductsPaginated('org-1', {
        nom: 'yaourt',
        statut: 'archive',
        includeArchived: true,
      });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organization_id: 'org-1',
            nom: { contains: 'yaourt', mode: 'insensitive' },
            is_active: false,
          },
        })
      );
    });

    // Invariant de sécurité : un rôle en lecture reste borné aux actifs, même en forçant `statut`.
    it('sans includeArchived → actifs seuls, le filtre statut est ignoré', async () => {
      mockProductPage(0);

      await catalogService.getProductsPaginated('org-1', { statut: 'archive' });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organization_id: 'org-1', is_active: true }),
        })
      );
    });

    it('compte le total sur le MÊME filtre que la page', async () => {
      mockProductPage(0);

      await catalogService.getProductsPaginated('org-1', { nom: 'lait', includeArchived: true });

      const countArgs = vi.mocked(prisma.product.count).mock.calls[0][0];
      const findArgs = vi.mocked(prisma.product.findMany).mock.calls[0][0];
      expect(countArgs?.where).toEqual(findArgs?.where);
    });
  });

  describe('getAllBatches', () => {
    it('doit lister la première page cloisonnée par organisation, 100 lots par défaut', async () => {
      mockBatchPage(0);

      await catalogService.getAllBatches('org-1');

      expect(prisma.batch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organization_id: 'org-1', OR: undefined },
          skip: 0,
          take: 100,
          orderBy: { date_creation: 'desc' },
        })
      );
    });

    /**
     * ⚠️ Le cœur de la correction. Auparavant la route servait `take: 100` et rien d'autre : au-delà,
     * un lot bien réel était introuvable. Le décalage doit suivre la page demandée.
     */
    it('doit décaler la lecture pour servir une page au-delà des 100 lots les plus récents', async () => {
      mockBatchPage(342);

      await catalogService.getAllBatches('org-1', { page: 3, limit: 50 });

      expect(prisma.batch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 100, take: 50 })
      );
    });

    it('doit retourner le total de TOUS les lots correspondants, pas la taille de la page', async () => {
      mockBatchPage(342, [{ id: 'batch-1' }]);

      const result = await catalogService.getAllBatches('org-1', { page: 2, limit: 100 });

      expect(result.pagination).toEqual({ page: 2, limit: 100, total: 342, totalPages: 4 });
      expect(result.data).toEqual([{ id: 'batch-1' }]);
    });

    it('compte le total sur le MÊME filtre que la page (recherche comprise)', async () => {
      mockBatchPage(2);

      await catalogService.getAllBatches('org-1', { search: 'yaourt' });

      const countArgs = vi.mocked(prisma.batch.count).mock.calls[0][0];
      const findArgs = vi.mocked(prisma.batch.findMany).mock.calls[0][0];
      expect(countArgs?.where).toEqual(findArgs?.where);
    });

    it('annonce 0 page quand aucun lot ne correspond, plutôt qu une page vide', async () => {
      mockBatchPage(0);

      const result = await catalogService.getAllBatches('org-1', { search: 'inexistant' });

      expect(result.pagination.totalPages).toBe(0);
      expect(result.data).toEqual([]);
    });

    it("n'expose PAS l'auteur du lot par défaut (nom + email = donnée personnelle)", async () => {
      mockBatchPage(0);

      await catalogService.getAllBatches('org-1');

      expect(prisma.batch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            produit: { select: { nom: true, code_gtin: true } },
            unite: { select: { nom: true } },
            materiel: {
              select: {
                nom: true,
                lieu: { select: { nom: true, latitude: true, longitude: true } },
              },
            },
          },
        })
      );
    });

    it("expose l'auteur du lot UNIQUEMENT pour l'administration", async () => {
      mockBatchPage(0);

      await catalogService.getAllBatches('org-1', { revealAuthor: true });

      expect(prisma.batch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            user: { select: { name: true, email: true } },
          }),
        })
      );
    });

    /**
     * ⚠️ `lot_number` et le GTIN manquaient au OR : l'opérateur qui recopiait le numéro lu sur
     * l'étiquette — la seule référence qu'il ait sous les yeux — n'obtenait aucun résultat.
     */
    it('doit chercher sur le numéro de lot GS1, le GTIN, l id, le nom produit et le statut', async () => {
      mockBatchPage(0);

      await catalogService.getAllBatches('org-1', { search: 'yaourt' });

      expect(prisma.batch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organization_id: 'org-1',
            OR: [
              { lot_number: { contains: 'yaourt', mode: 'insensitive' } },
              { id: { contains: 'yaourt', mode: 'insensitive' } },
              { produit: { nom: { contains: 'yaourt', mode: 'insensitive' } } },
              { produit: { code_gtin: { contains: 'yaourt', mode: 'insensitive' } } },
              { statut: { contains: 'yaourt', mode: 'insensitive' } },
            ],
          },
        })
      );
    });

    it('la recherche reste cloisonnée par organisation (le filtre org est hors du OR)', async () => {
      mockBatchPage(0);

      await catalogService.getAllBatches('org-1', { search: 'lait' });

      const args = vi.mocked(prisma.batch.findMany).mock.calls[0][0];
      expect(args?.where?.organization_id).toBe('org-1');
    });

    /**
     * Les filtres de colonnes restreignent dans la requête (ET), sur TOUTE l'organisation — et non
     * plus sur la page reçue côté front, où un lot correspondant en page 2+ échappait au filtre.
     */
    describe('filtres de colonnes', () => {
      it('filtre par statut (égalité exacte)', async () => {
        mockBatchPage(0);
        await catalogService.getAllBatches('org-1', { statut: 'BLOQUE' });
        expect(prisma.batch.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ statut: 'BLOQUE' }) })
        );
      });

      it('filtre par produit (id_produit)', async () => {
        mockBatchPage(0);
        await catalogService.getAllBatches('org-1', { produit: 'prod-1' });
        expect(prisma.batch.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ id_produit: 'prod-1' }) })
        );
      });

      it('filtre par site via l emplacement du matériel qui stocke le lot', async () => {
        mockBatchPage(0);
        await catalogService.getAllBatches('org-1', { site: 'loc-1' });
        expect(prisma.batch.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ materiel: { id_lieu: 'loc-1' } }) })
        );
      });

      it('filtre par numéro de lot (contains, insensible à la casse)', async () => {
        mockBatchPage(0);
        await catalogService.getAllBatches('org-1', { lot: '000201' });
        expect(prisma.batch.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              lot_number: { contains: '000201', mode: 'insensitive' },
            }),
          })
        );
      });

      it('filtre par GTIN (contains sur le produit)', async () => {
        mockBatchPage(0);
        await catalogService.getAllBatches('org-1', { gtin: '3042' });
        expect(prisma.batch.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              produit: { code_gtin: { contains: '3042', mode: 'insensitive' } },
            }),
          })
        );
      });

      it('ignore un filtre vide (produit: "") plutôt que de filtrer sur une chaîne vide', async () => {
        mockBatchPage(0);
        await catalogService.getAllBatches('org-1', { produit: '' });
        const args = vi.mocked(prisma.batch.findMany).mock.calls[0][0];
        expect(args?.where?.id_produit).toBeUndefined();
      });

      it('combine plusieurs filtres, et compte le total sur le MÊME where', async () => {
        mockBatchPage(0);
        await catalogService.getAllBatches('org-1', {
          statut: 'EN_STOCK',
          produit: 'prod-1',
          site: 'loc-1',
        });
        const findArgs = vi.mocked(prisma.batch.findMany).mock.calls[0][0];
        const countArgs = vi.mocked(prisma.batch.count).mock.calls[0][0];
        expect(findArgs?.where).toEqual(
          expect.objectContaining({
            organization_id: 'org-1',
            statut: 'EN_STOCK',
            id_produit: 'prod-1',
            materiel: { id_lieu: 'loc-1' },
          })
        );
        expect(countArgs?.where).toEqual(findArgs?.where);
      });
    });
  });
});
