import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    product: { findMany: vi.fn() },
    batch: { findMany: vi.fn() },
  },
}));

import { catalogService } from './catalog.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';

describe('catalogService.getAllProducts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('filtre par organisation et trie les produits par nom', async () => {
    const products = [{ id: 'p1', nom: 'Beurre' }];
    vi.mocked(prisma.product.findMany).mockResolvedValue(products as never);

    const result = await catalogService.getAllProducts('org-1');

    expect(result).toEqual(products);
    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { organization_id: 'org-1' },
      orderBy: { nom: 'asc' },
    });
  });
});

describe('catalogService.getAllBatches', () => {
  beforeEach(() => vi.clearAllMocks());

  it("ne pose pas de clause OR quand aucune recherche n'est fournie", async () => {
    vi.mocked(prisma.batch.findMany).mockResolvedValue([] as never);

    await catalogService.getAllBatches('org-1');

    const args = vi.mocked(prisma.batch.findMany).mock.calls[0][0];
    expect(args?.where).toMatchObject({ organization_id: 'org-1', OR: undefined });
    expect(args?.take).toBe(100);
  });

  it('construit une recherche insensible à la casse sur id, produit et statut', async () => {
    vi.mocked(prisma.batch.findMany).mockResolvedValue([] as never);

    await catalogService.getAllBatches('org-1', 'yaourt');

    const args = vi.mocked(prisma.batch.findMany).mock.calls[0][0];
    expect(args?.where?.OR).toEqual([
      { id: { contains: 'yaourt', mode: 'insensitive' } },
      { produit: { nom: { contains: 'yaourt', mode: 'insensitive' } } },
      { statut: { contains: 'yaourt', mode: 'insensitive' } },
    ]);
  });

  it('limite à 100 lots et trie par date de création décroissante', async () => {
    vi.mocked(prisma.batch.findMany).mockResolvedValue([] as never);

    await catalogService.getAllBatches('org-1');

    const args = vi.mocked(prisma.batch.findMany).mock.calls[0][0];
    expect(args?.take).toBe(100);
    expect(args?.orderBy).toEqual({ date_creation: 'desc' });
  });
});
