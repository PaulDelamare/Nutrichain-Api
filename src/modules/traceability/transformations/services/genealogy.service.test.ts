import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    batch: { findMany: vi.fn() },
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

  describe('getOrigins', () => {
    it('inclut le lot LUI-MÊME quand il est reçu directement (aucun ancêtre)', async () => {
      // getUpstream (la CTE) ne renvoie QUE les ancêtres : pour un lait cru scanné directement,
      // c'est vide. L'origine doit néanmoins remonter — via le lot lui-même.
      vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
      vi.mocked(prisma.batch.findMany).mockResolvedValue([
        {
          lot_number: 'LAIT-001',
          receipt: {
            date_reception: new Date('2026-07-14T08:00:00Z'),
            fournisseur: { id: 'sup-1', nom_ferme: 'Ferme des Aubépines' },
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any);

      const origins = await genealogyService.getOrigins('lot-lait', 'org-1');

      // Le lot interrogé fait partie des candidats, même sans ancêtre.
      const [args] = vi.mocked(prisma.batch.findMany).mock.calls[0];
      expect(args.where?.id).toMatchObject({ in: ['lot-lait'] });
      expect(origins).toEqual([
        {
          lot_number: 'LAIT-001',
          date_reception: new Date('2026-07-14T08:00:00Z'),
          fournisseur: { id: 'sup-1', nom_ferme: 'Ferme des Aubépines' },
        },
      ]);
    });

    it('ne renvoie aucune origine pour un lot sans réception liée (produit fini pur)', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
      vi.mocked(prisma.batch.findMany).mockResolvedValue([]);

      const origins = await genealogyService.getOrigins('lot-fini', 'org-1');

      expect(origins).toEqual([]);
    });

    it('cloisonne : filtre les lots ET la réception sur l’organisation', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: 'lot-parent' }]);
      vi.mocked(prisma.batch.findMany).mockResolvedValue([]);

      await genealogyService.getOrigins('lot-enfant', 'org-1');

      const [args] = vi.mocked(prisma.batch.findMany).mock.calls[0];
      expect(args.where).toMatchObject({
        organization_id: 'org-1',
        id_receipt: { not: null },
        receipt: { organization_id: 'org-1' },
      });
      // le lot interrogé + ses ancêtres
      expect(args.where?.id).toMatchObject({ in: ['lot-enfant', 'lot-parent'] });
    });
  });
});
