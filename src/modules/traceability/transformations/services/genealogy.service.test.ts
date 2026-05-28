import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

import { genealogyService } from './genealogy.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';

describe('GenealogyService (smoke)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getUpstream renvoie le résultat brut de la CTE Prisma', async () => {
    const fakeAncestors = [{ id: 'lot-parent', nom_produit: 'Lait', organization_id: 'org-1' }];
    vi.mocked(prisma.$queryRaw).mockResolvedValue(fakeAncestors);

    const result = await genealogyService.getUpstream('lot-enfant', 'org-1');

    expect(result).toEqual(fakeAncestors);
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });

  it('getDownstream renvoie le résultat brut de la CTE Prisma', async () => {
    const fakeDescendants = [{ id: 'lot-enfant', nom_produit: 'Yaourt', organization_id: 'org-1' }];
    vi.mocked(prisma.$queryRaw).mockResolvedValue(fakeDescendants);

    const result = await genealogyService.getDownstream('lot-parent', 'org-1');

    expect(result).toEqual(fakeDescendants);
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });

  it("accepte une TransactionClient optionnelle et l'utilise au lieu du prisma global", async () => {
    const txQueryRaw = vi.fn().mockResolvedValue([]);
    const tx = { $queryRaw: txQueryRaw };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await genealogyService.getUpstream('lot-x', 'org-1', tx as any);

    expect(txQueryRaw).toHaveBeenCalledOnce();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
