import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Alert, Prisma } from '@prisma/client';
import { alertBatchService } from './alertBatch.service';
import { prisma } from '../../../shared/configs/prismaClient.config';

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    batch_Mouvement: {
      findMany: vi.fn(),
    },
  },
}));

const findMany = vi.mocked(prisma.batch_Mouvement.findMany);

const ALERT_ID = 'alert-froid-1';
const ORG_ID = 'org-1';

const alert = {
  id: ALERT_ID,
  organization_id: ORG_ID,
  type: 'TEMP_EXCURSION',
  statut: 'ACTIVE',
} as Alert;

const ISOLATED_AT = new Date('2026-07-14T08:00:00Z');

/** Un mouvement de quarantaine froid, tel que le renvoie la 1re requête (avec son lot). */
const quarantine = (lotId: string, lotNumber: string, at = ISOLATED_AT) => ({
  id_lot: lotId,
  created_at: at,
  lot: {
    id: lotId,
    lot_number: lotNumber,
    quantite_actuelle: new Prisma.Decimal('12.5'),
    unite_code: 'KGM',
    produit: { nom: 'Saumon fumé' },
  },
});

/** Un contrôle qualité NON CONFORME, tel que le renvoie la 2e requête. */
const nonConformity = (lotId: string, at: Date) => ({ id_lot: lotId, created_at: at });

// La 1re requête renvoie les quarantaines, la 2e les non-conformités.
const mockQueries = (quarantines: unknown[], nonConformities: unknown[] = []) => {
  findMany
    .mockResolvedValueOnce(quarantines as never)
    .mockResolvedValueOnce(nonConformities as never);
};

beforeEach(() => {
  // `clearAllMocks` ne purge PAS la file des `mockResolvedValueOnce` : les réponses non consommées
  // débordaient sur le test suivant, qui lisait alors la réponse du précédent.
  vi.resetAllMocks();
});

describe('alertBatchService.listBatchesIsolatedByAlert', () => {
  it('ne demande QUE les lots isolés par cette alerte, et encore bloqués', async () => {
    mockQueries([]);

    await alertBatchService.listBatchesIsolatedByAlert(alert);

    // C'est ICI que se joue le relâchement non consenti : sans ce filtre, on ramasse tous les
    // lots BLOQUE de l'organisation présents dans le frigo, quelle qu'en soit la cause.
    const where = findMany.mock.calls[0]![0]!.where!;
    expect(where.type_action).toBe('QUARANTAINE_FROID');
    expect(where.metadata).toEqual({ path: ['id_alerte'], equals: ALERT_ID });
    expect(where.lot).toEqual({ organization_id: ORG_ID, statut: 'BLOQUE' });
  });

  it('sans lot isolé, ne va pas chercher les non-conformités', async () => {
    findMany.mockResolvedValueOnce([] as never);

    expect(await alertBatchService.listBatchesIsolatedByAlert(alert)).toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('déclare levable un lot isolé par cette alerte et sans contrôle non conforme', async () => {
    mockQueries([quarantine('lot-a', 'LOT-A')]);

    const [batch] = await alertBatchService.listBatchesIsolatedByAlert(alert);

    expect(batch).toMatchObject({
      id: 'lot-a',
      lot_number: 'LOT-A',
      unite_code: 'KGM',
      produit: { nom: 'Saumon fumé' },
      levable: true,
      motif_blocage: null,
    });
    expect(batch!.quantite_actuelle.toString()).toBe('12.5');
  });

  it('REFUSE de lever un lot déclaré non conforme APRÈS son isolement', async () => {
    // Le cas que l'application ne voyait pas : le froid bloque le lot, puis le labo le déclare
    // impropre. `nextStatus` laisse le statut à BLOQUE (déjà bloqué) mais écrit le mouvement.
    // Réparer la chambre froide ne rend pas ce lot consommable.
    mockQueries(
      [quarantine('lot-a', 'LOT-A')],
      [nonConformity('lot-a', new Date('2026-07-14T10:00:00Z'))]
    );

    const [batch] = await alertBatchService.listBatchesIsolatedByAlert(alert);

    expect(batch!.levable).toBe(false);
    expect(batch!.motif_blocage).toBe('CONTROLE_NON_CONFORME');
  });

  it("IGNORE une non-conformité ANTÉRIEURE à l'isolement : elle a déjà été tranchée", async () => {
    // Le lot avait été bloqué par un contrôle, puis levé, remis en stock — et il subit
    // l'excursion. Le condamner sur cette vieille non-conformité le bloquerait pour toujours.
    mockQueries(
      [quarantine('lot-a', 'LOT-A')],
      [nonConformity('lot-a', new Date('2026-07-01T09:00:00Z'))]
    );

    const [batch] = await alertBatchService.listBatchesIsolatedByAlert(alert);

    expect(batch!.levable).toBe(true);
    expect(batch!.motif_blocage).toBeNull();
  });

  it("n'attribue pas la non-conformité d'un lot à un AUTRE lot de la même alerte", async () => {
    mockQueries(
      [quarantine('lot-a', 'LOT-A'), quarantine('lot-b', 'LOT-B')],
      [nonConformity('lot-b', new Date('2026-07-14T10:00:00Z'))]
    );

    const batches = await alertBatchService.listBatchesIsolatedByAlert(alert);

    expect(batches.map((b) => [b.id, b.levable])).toEqual([
      ['lot-a', true],
      ['lot-b', false],
    ]);
  });

  it('ne cherche les non-conformités que sur les lots de cette alerte', async () => {
    mockQueries([quarantine('lot-a', 'LOT-A'), quarantine('lot-b', 'LOT-B')]);

    await alertBatchService.listBatchesIsolatedByAlert(alert);

    const where = findMany.mock.calls[1]![0]!.where!;
    expect(where.id_lot).toEqual({ in: ['lot-a', 'lot-b'] });
    expect(where.type_action).toBe('CONTROLE_QUALITE');
    expect(where.metadata).toEqual({ path: ['resultat'], equals: 'NON_CONFORME' });
  });
});
