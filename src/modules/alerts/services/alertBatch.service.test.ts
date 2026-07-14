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
  },
}));

const findMany = vi.mocked(prisma.batch_Mouvement.findMany);

const ALERT_ID = 'alert-froid-1';
const AUTRE_ALERTE = 'alert-froid-2';
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
const isolement = (id: number, lotId: string, idAlerte = ALERT_ID) => ({
  id,
  id_lot: lotId,
  type_action: 'QUARANTAINE_FROID',
  metadata: { id_alerte: idAlerte },
});
const levee = (id: number, lotId: string) => ({
  id,
  id_lot: lotId,
  type_action: 'LEVEE_QUARANTAINE',
  metadata: {},
});
const controle = (id: number, lotId: string, resultat: 'CONFORME' | 'NON_CONFORME') => ({
  id,
  id_lot: lotId,
  type_action: 'CONTROLE_QUALITE',
  metadata: { resultat },
});

// 1re requête : les lots candidats. 2e : leur historique de blocage.
const mockQueries = (candidates: unknown[], history: unknown[] = []) => {
  findMany.mockResolvedValueOnce(candidates as never).mockResolvedValueOnce(history as never);
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
    const rappel = { ...alert, type: 'PRODUCT_RECALL' } as Alert;

    await expect(alertBatchService.listBatchesIsolatedByAlert(rappel)).rejects.toThrow(APIError);
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
    mockQueries([candidate('lot-a', 'LOT-A')], [isolement(1, 'lot-a')]);

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
      [isolement(1, 'lot-a'), levee(2, 'lot-a'), isolement(3, 'lot-a', AUTRE_ALERTE)]
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
      [isolement(1, 'lot-a'), isolement(2, 'lot-a', AUTRE_ALERTE)]
    );

    expect(await alertBatchService.listBatchesIsolatedByAlert(alert)).toEqual([]);
  });

  it('EXCLUT un lot dont notre isolement a été levé et qui est bloqué pour autre chose depuis', async () => {
    mockQueries(
      [candidate('lot-a', 'LOT-A')],
      [isolement(1, 'lot-a'), levee(2, 'lot-a'), controle(3, 'lot-a', 'NON_CONFORME')]
    );

    expect(await alertBatchService.listBatchesIsolatedByAlert(alert)).toEqual([]);
  });

  it('REFUSE de lever un lot déclaré non conforme APRÈS son isolement', async () => {
    // `nextStatus` laisse un lot déjà BLOQUE inchangé quand le contrôle est non conforme — mais il
    // ÉCRIT le mouvement. Le lot est isolé par le froid ET impropre : réparer le frigo n'y change rien.
    mockQueries(
      [candidate('lot-a', 'LOT-A')],
      [isolement(1, 'lot-a'), controle(2, 'lot-a', 'NON_CONFORME')]
    );

    const [batch] = await alertBatchService.listBatchesIsolatedByAlert(alert);

    expect(batch!.levable).toBe(false);
    expect(batch!.motif_blocage).toBe('CONTROLE_NON_CONFORME');
  });

  it("IGNORE une non-conformité ANTÉRIEURE à l'isolement : elle a déjà été tranchée", async () => {
    // Le lot avait été bloqué par un contrôle, puis levé, remis en stock — et il subit l'excursion.
    // Le condamner sur cette vieille non-conformité le bloquerait pour toujours.
    mockQueries(
      [candidate('lot-a', 'LOT-A')],
      [controle(1, 'lot-a', 'NON_CONFORME'), levee(2, 'lot-a'), isolement(3, 'lot-a')]
    );

    const [batch] = await alertBatchService.listBatchesIsolatedByAlert(alert);

    expect(batch!.levable).toBe(true);
    expect(batch!.motif_blocage).toBeNull();
  });

  it('un contrôle CONFORME postérieur ne condamne pas le lot', async () => {
    mockQueries(
      [candidate('lot-a', 'LOT-A')],
      [isolement(1, 'lot-a'), controle(2, 'lot-a', 'CONFORME')]
    );

    const [batch] = await alertBatchService.listBatchesIsolatedByAlert(alert);

    expect(batch!.levable).toBe(true);
  });

  it("n'attribue pas la non-conformité d'un lot à un AUTRE lot de la même alerte", async () => {
    mockQueries(
      [candidate('lot-a', 'LOT-A'), candidate('lot-b', 'LOT-B')],
      [isolement(1, 'lot-a'), isolement(2, 'lot-b'), controle(3, 'lot-b', 'NON_CONFORME')]
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
      in: ['QUARANTAINE_FROID', 'LEVEE_QUARANTAINE', 'CONTROLE_QUALITE'],
    });
    // ⚠️ `id` (auto-incrément), pas `created_at` : deux mouvements d'une même transaction portent le
    // même horodatage, et l'ordre serait alors indéterminé.
    expect(call.orderBy).toEqual({ id: 'asc' });
  });
});
