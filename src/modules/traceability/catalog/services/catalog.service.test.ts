import { describe, it, expect, vi, beforeEach } from 'vitest';
import { catalogService } from './catalog.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    product: { findMany: vi.fn() },
    batch: { findMany: vi.fn() },
  },
}));

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
        where: { organization_id: 'org-1' },
        orderBy: { nom: 'asc' },
      });
      expect(result).toBe(products);
    });
  });

  describe('getAllBatches', () => {
    it('doit lister les lots cloisonnés par organisation avec un plafond de 100', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.findMany).mockResolvedValue([] as any);

      await catalogService.getAllBatches('org-1');

      expect(prisma.batch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organization_id: 'org-1', OR: undefined },
          take: 100,
          orderBy: { date_creation: 'desc' },
        })
      );
    });

    it("n'expose PAS l'auteur du lot par défaut (nom + email = donnée personnelle)", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.findMany).mockResolvedValue([] as any);

      await catalogService.getAllBatches('org-1');

      expect(prisma.batch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            produit: { select: { nom: true, code_gtin: true } },
            unite: { select: { nom: true } },
            materiel: { select: { nom: true, lieu: { select: { nom: true } } } },
          },
        })
      );
    });

    it("expose l'auteur du lot UNIQUEMENT pour l'administration", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.findMany).mockResolvedValue([] as any);

      await catalogService.getAllBatches('org-1', undefined, true);

      expect(prisma.batch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            user: { select: { name: true, email: true } },
          }),
        })
      );
    });

    it('doit filtrer par recherche insensible à la casse sur id, nom produit et statut', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.findMany).mockResolvedValue([] as any);

      await catalogService.getAllBatches('org-1', 'yaourt');

      expect(prisma.batch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organization_id: 'org-1',
            OR: [
              { id: { contains: 'yaourt', mode: 'insensitive' } },
              { produit: { nom: { contains: 'yaourt', mode: 'insensitive' } } },
              { statut: { contains: 'yaourt', mode: 'insensitive' } },
            ],
          },
        })
      );
    });

    it('la recherche reste cloisonnée par organisation (le filtre org est hors du OR)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.findMany).mockResolvedValue([] as any);

      await catalogService.getAllBatches('org-1', 'lait');

      const args = vi.mocked(prisma.batch.findMany).mock.calls[0][0];
      expect(args?.where?.organization_id).toBe('org-1');
    });
  });
});
