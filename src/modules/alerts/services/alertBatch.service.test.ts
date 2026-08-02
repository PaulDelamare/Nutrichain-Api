import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Alert, Prisma } from '@prisma/client';
import { alertBatchService } from './alertBatch.service';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    batch_Mouvement: {
      findMany: vi.fn(),
    },
    qualityControl: {
      findMany: vi.fn(),
    },
  },
}));

const findMany = vi.mocked(prisma.batch_Mouvement.findMany);
const findVerdicts = vi.mocked(prisma.qualityControl.findMany);

const ALERT_ID = 'alert-froid-1';
const OTHER_ALERT = 'alert-froid-2';
const ORG_ID = 'org-1';

const alert = {
  id: ALERT_ID,
  organization_id: ORG_ID,
  type: 'TEMP_EXCURSION',
  statut: 'ACTIVE',
} as Alert;

/** Un lot candidat, tel que le renvoie la 1re requête. */
const candidate = (lotId: string, lotNumber: string) => ({
  id_lot: lotId,
  lot: {
    id: lotId,
    lot_number: lotNumber,
    quantite_actuelle: new Prisma.Decimal('12.5'),
    unite_code: 'KGM',
    produit: { nom: 'Saumon fumé' },
  },
});

/**
 * Un mouvement de l'historique. `id` est la clé d'ordre (auto-incrément) : c'est elle qui dit ce qui
 * s'est passé APRÈS quoi — jamais `created_at`, qui peut être identique au sein d'une transaction.
 */
const isolation = (id: number, lotId: string, alertId = ALERT_ID) => ({
  id,
  id_lot: lotId,
  type_action: 'QUARANTAINE_FROID',
  metadata: { id_alerte: alertId },
});
const lift = (id: number, lotId: string) => ({
  id,
  id_lot: lotId,
  type_action: 'LEVEE_QUARANTAINE',
  metadata: {},
});
/**
 * Un verdict qualité. `day` porte la chronologie : c'est `date_test` qui dit si une contre-analyse
 * dément la non-conformité, et non l'ordre d'insertion.
 */
const verdict = (lotId: string, resultat: 'CONFORME' | 'NON_CONFORME', day: number) => ({
  id: `qc-${lotId}-${day}`,
  id_lot: lotId,
  resultat,
  id_user_labo: 'user-labo',
  date_test: new Date(`2026-08-${String(day).padStart(2, '0')}`),
});

// 1re requête : les lots candidats. 2e : leur historique d'isolement. 3e : leurs verdicts qualité.
const mockQueries = (candidates: unknown[], history: unknown[] = [], verdicts: unknown[] = []) => {
  findMany.mockResolvedValueOnce(candidates as never).mockResolvedValueOnce(history as never);
  findVerdicts.mockResolvedValueOnce(verdicts as never);
};

beforeEach(() => {
  // `clearAllMocks` ne purge PAS la file des `mockResolvedValueOnce` : les réponses non consommées
  // débordaient sur le test suivant, qui lisait alors la réponse du précédent.
  vi.resetAllMocks();
});

describe('alertBatchService.listBatchesIsolatedByAlert', () => {
  it("REFUSE une alerte qui n'isole pas de lot, au lieu de répondre « aucun lot »", async () => {
    // Un rappel produit bloque sa descendance en ALERTE via des mouvements RAPPEL. Répondre « 0 lot »
    // laisserait croire qu'il ne concerne personne : le mensonge le plus grave que puisse faire
    // cet endpoint. On ne confond pas « il n'y en a pas » et « la question n'a pas de sens ici ».
    const recall = { ...alert, type: 'PRODUCT_RECALL' } as Alert;

    await expect(alertBatchService.listBatchesIsolatedByAlert(recall)).rejects.toThrow(APIError);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('ne demande QUE les lots isolés par cette alerte, et encore bloqués', async () => {
    mockQueries([]);

    await alertBatchService.listBatchesIsolatedByAlert(alert);

    const where = findMany.mock.calls[0]![0]!.where!;
    expect(where.type_action).toBe('QUARANTAINE_FROID');
    expect(where.metadata).toEqual({ path: ['id_alerte'], equals: ALERT_ID });
    expect(where.lot).toEqual({ organization_id: ORG_ID, statut: 'BLOQUE' });
  });

  it('sans lot candidat, ne va pas chercher les historiques', async () => {
    findMany.mockResolvedValueOnce([] as never);

    expect(await alertBatchService.listBatchesIsolatedByAlert(alert)).toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('liste un lot isolé par cette alerte, encore bloqué, et sans contrôle non conforme', async () => {
    mockQueries([candidate('lot-a', 'LOT-A')], [isolation(1, 'lot-a')]);

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

  it("EXCLUT un lot qu'une excursion PLUS RÉCENTE retient désormais", async () => {
    // Le piège : ce lot a bien été isolé par notre alerte, et il est bien BLOQUE aujourd'hui — mais
    // ce n'est plus notre alerte qui le retient. Il a été relâché, puis ré-isolé par l'alerte
    // suivante. Le lister ici laisserait rouvrir la vieille alerte pour relâcher un lot que
    // l'alerte EN COURS retient, frigo toujours en panne.
    mockQueries(
      [candidate('lot-a', 'LOT-A')],
      [isolation(1, 'lot-a'), lift(2, 'lot-a'), isolation(3, 'lot-a', OTHER_ALERT)]
    );

    expect(await alertBatchService.listBatchesIsolatedByAlert(alert)).toEqual([]);
  });

  it('retient le DERNIER isolement, même si aucune levée ne les sépare', async () => {
    // Aujourd'hui, deux isolements sont toujours séparés par une levée (un lot BLOQUE n'est pas
    // re-quarantiné). Mais la règle est « l'isolement EN VIGUEUR est le dernier », et elle ne doit
    // pas dépendre de cette coïncidence : si un jour un chemin débloque un lot sans tracer de levée,
    // l'ancienne alerte ne doit toujours pas revendiquer un lot que la nouvelle retient.
    mockQueries(
      [candidate('lot-a', 'LOT-A')],
      [isolation(1, 'lot-a'), isolation(2, 'lot-a', OTHER_ALERT)]
    );

    expect(await alertBatchService.listBatchesIsolatedByAlert(alert)).toEqual([]);
  });

  it('EXCLUT un lot dont notre isolement a été levé et qui est bloqué pour autre chose depuis', async () => {
    mockQueries(
      [candidate('lot-a', 'LOT-A')],
      [isolation(1, 'lot-a'), lift(2, 'lot-a')],
      [verdict('lot-a', 'NON_CONFORME', 3)]
    );

    expect(await alertBatchService.listBatchesIsolatedByAlert(alert)).toEqual([]);
  });

  it('REFUSE de lever un lot déclaré non conforme APRÈS son isolement', async () => {
    // Le lot est isolé par le froid ET impropre : réparer le frigo n'y change rien.
    mockQueries(
      [candidate('lot-a', 'LOT-A')],
      [isolation(1, 'lot-a')],
      [verdict('lot-a', 'NON_CONFORME', 2)]
    );

    const [batch] = await alertBatchService.listBatchesIsolatedByAlert(alert);

    expect(batch!.levable).toBe(false);
    expect(batch!.motif_blocage).toBe('CONTROLE_NON_CONFORME');
  });

  /**
   * Une non-conformité ANTÉRIEURE à l'isolement condamne le lot comme une autre tant qu'aucune
   * contre-analyse ne la dément. L'écran annonçait « levable » dans ce cas, alors que la levée
   * froid, elle, refusait : il promettait une action que l'API refuse. C'est l'écran qui mentait.
   */
  it("condamne sur une non-conformité non démentie, même ANTÉRIEURE à l'isolement", async () => {
    mockQueries(
      [candidate('lot-a', 'LOT-A')],
      [lift(2, 'lot-a'), isolation(3, 'lot-a')],
      [verdict('lot-a', 'NON_CONFORME', 1)]
    );

    const [batch] = await alertBatchService.listBatchesIsolatedByAlert(alert);

    expect(batch!.levable).toBe(false);
    expect(batch!.motif_blocage).toBe('CONTROLE_NON_CONFORME');
  });

  /** La contre-analyse conforme rend le lot levable — c'est ce qui débloque le lot condamné. */
  it('une contre-analyse conforme POSTÉRIEURE rend le lot levable', async () => {
    mockQueries(
      [candidate('lot-a', 'LOT-A')],
      [isolation(1, 'lot-a')],
      [verdict('lot-a', 'NON_CONFORME', 2), verdict('lot-a', 'CONFORME', 3)]
    );

    const [batch] = await alertBatchService.listBatchesIsolatedByAlert(alert);

    expect(batch!.levable).toBe(true);
    expect(batch!.motif_blocage).toBeNull();
  });

  /** Un conforme ANTÉRIEUR ne dément rien : c'est la non-conformité qui a eu le dernier mot. */
  it("un contrôle conforme ANTÉRIEUR à la non-conformité ne la dément pas", async () => {
    mockQueries(
      [candidate('lot-a', 'LOT-A')],
      [isolation(1, 'lot-a')],
      [verdict('lot-a', 'CONFORME', 1), verdict('lot-a', 'NON_CONFORME', 2)]
    );

    const [batch] = await alertBatchService.listBatchesIsolatedByAlert(alert);

    expect(batch!.levable).toBe(false);
  });

  it("n'attribue pas la non-conformité d'un lot à un AUTRE lot de la même alerte", async () => {
    mockQueries(
      [candidate('lot-a', 'LOT-A'), candidate('lot-b', 'LOT-B')],
      [isolation(1, 'lot-a'), isolation(2, 'lot-b')],
      [verdict('lot-b', 'NON_CONFORME', 3)]
    );

    const batches = await alertBatchService.listBatchesIsolatedByAlert(alert);

    expect(batches.map((b) => [b.id, b.levable])).toEqual([
      ['lot-a', true],
      ['lot-b', false],
    ]);
  });

  it("lit l'historique des lots candidats, dans l'ordre des mouvements", async () => {
    mockQueries([candidate('lot-a', 'LOT-A'), candidate('lot-b', 'LOT-B')]);

    await alertBatchService.listBatchesIsolatedByAlert(alert);

    const call = findMany.mock.calls[1]![0]!;
    expect(call.where!.id_lot).toEqual({ in: ['lot-a', 'lot-b'] });
    expect(call.where!.type_action).toEqual({
      in: ['QUARANTAINE_FROID', 'LEVEE_QUARANTAINE'],
    });
    // ⚠️ `id` (auto-incrément), pas `created_at` : deux mouvements d'une même transaction portent le
    // même horodatage, et l'ordre serait alors indéterminé.
    expect(call.orderBy).toEqual({ id: 'asc' });
  });
});
