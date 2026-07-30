import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reconcileLogisticUnitContent } from './reconcileLogisticUnitContent';

const tx = {
  logistic_Unit_Content: { deleteMany: vi.fn(), updateMany: vi.fn() },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asTx = () => tx as any;

describe('reconcileLogisticUnitContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.logistic_Unit_Content.deleteMany.mockResolvedValue({ count: 1 });
    tx.logistic_Unit_Content.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('stock épuisé — le lot quitte la palette', () => {
    it('supprime la ligne de contenu quand il ne reste rien', async () => {
      await reconcileLogisticUnitContent(asTx(), {
        batchId: 'lot-1',
        organizationId: 'org-1',
        remainingQuantity: 0,
      });

      expect(tx.logistic_Unit_Content.deleteMany).toHaveBeenCalledTimes(1);
      expect(tx.logistic_Unit_Content.updateMany).not.toHaveBeenCalled();
    });

    it('cloisonne la suppression par organisation, jamais sur le seul identifiant du lot', async () => {
      await reconcileLogisticUnitContent(asTx(), {
        batchId: 'lot-1',
        organizationId: 'org-1',
        remainingQuantity: 0,
      });

      const where = tx.logistic_Unit_Content.deleteMany.mock.calls[0][0].where;

      expect(where.id_lot).toBe('lot-1');
      // Sans ce filtre, `deleteMany` porterait sur toutes les organisations : un identifiant de lot
      // deviné suffirait à démonter la palette d'un tenant voisin.
      expect(where.unite_logistique).toEqual({ organization_id: 'org-1' });
    });

    it('traite une quantité négative comme un stock épuisé', async () => {
      await reconcileLogisticUnitContent(asTx(), {
        batchId: 'lot-1',
        organizationId: 'org-1',
        remainingQuantity: -5,
      });

      expect(tx.logistic_Unit_Content.deleteMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('stock partiel — la palette ne déclare pas plus que le reste', () => {
    it('ramène la quantité déclarée au stock restant', async () => {
      await reconcileLogisticUnitContent(asTx(), {
        batchId: 'lot-1',
        organizationId: 'org-1',
        remainingQuantity: 10,
      });

      expect(tx.logistic_Unit_Content.deleteMany).not.toHaveBeenCalled();
      expect(tx.logistic_Unit_Content.updateMany).toHaveBeenCalledWith({
        where: {
          id_lot: 'lot-1',
          unite_logistique: { organization_id: 'org-1' },
          // Ne touche QUE les palettes qui en déclarent trop : une palette qui portait déjà moins
          // que le reste n'a aucune raison de voir sa quantité relevée.
          quantite: { gt: 10 },
        },
        data: { quantite: 10 },
      });
    });

    it('cloisonne aussi la mise à jour par organisation', async () => {
      await reconcileLogisticUnitContent(asTx(), {
        batchId: 'lot-1',
        organizationId: 'org-1',
        remainingQuantity: 10,
      });

      const where = tx.logistic_Unit_Content.updateMany.mock.calls[0][0].where;

      expect(where.unite_logistique).toEqual({ organization_id: 'org-1' });
    });
  });
});
