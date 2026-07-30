import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logisticUnitService } from './logisticUnit.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { auditService } from '../../../../shared/utils/audit/audit.service';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    batch: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    batch_Mouvement: { create: vi.fn(), createMany: vi.fn() },
    equipment: { findFirst: vi.fn() },
    logistic_Unit: { create: vi.fn(), findFirst: vi.fn() },
    logistic_Unit_Content: { createMany: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    ePCIS_Event: { create: vi.fn() },
    organization: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (cb) => cb(prisma)),
  },
}));

vi.mock('../../../../shared/utils/audit/audit.service', () => ({
  auditService: { logAction: vi.fn() },
}));

const ORG = 'org-1';
const USER = 'user-1';
const FRIGO = { id: 'frigo-B', organization_id: ORG, type: 'FRIGO' };

const contenu = (statut = 'EN_STOCK') => [
  {
    id_lot: 'lot-1',
    quantite: 30,
    unite: 'kg',
    lot: {
      id: 'lot-1',
      lot_number: '260729-AAAAAA',
      statut,
      version: 3,
      id_materiel_actuel: 'frigo-A',
      quantite_actuelle: 100,
      unite_code: 'kg',
    },
  },
  {
    id_lot: 'lot-2',
    quantite: 20,
    unite: 'kg',
    lot: {
      id: 'lot-2',
      lot_number: '260729-BBBBBB',
      statut: 'EN_ATTENTE_QC',
      version: 1,
      id_materiel_actuel: 'frigo-A',
      quantite_actuelle: 50,
      unite_code: 'kg',
    },
  },
];

const palette = (statut?: string) => ({
  id: 'palette-1',
  organization_id: ORG,
  sscc: '380123400000000428',
  contenu: contenu(statut),
});

describe('logisticUnitService.moveLogisticUnit — ranger une palette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.equipment.findFirst).mockResolvedValue(FRIGO as any);
    vi.mocked(prisma.batch.updateMany).mockResolvedValue({ count: 1 } as never);
    // Par défaut : aucun lot de la palette n'est posé sur une autre palette.
    vi.mocked(prisma.logistic_Unit_Content.findMany).mockResolvedValue([] as never);
  });

  it('déplace TOUS les lots de la palette, en un seul geste', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(palette() as any);

    const result = await logisticUnitService.moveLogisticUnit('palette-1', ORG, USER, 'frigo-B');

    expect(result.lots_deplaces).toBe(2);
    expect(prisma.batch.updateMany).toHaveBeenCalledTimes(2);
    // Verrou optimiste : la version lue est dans le `where` de chaque lot.
    expect(prisma.batch.updateMany).toHaveBeenCalledWith({
      where: { id: 'lot-1', organization_id: ORG, version: 3 },
      data: { id_materiel_actuel: 'frigo-B', version: { increment: 1 } },
    });
  });

  it('ne touche QUE la position : ni statut, ni statut_avant_blocage', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(palette() as any);

    await logisticUnitService.moveLogisticUnit('palette-1', ORG, USER, 'frigo-B');

    for (const call of vi.mocked(prisma.batch.updateMany).mock.calls) {
      expect(call[0].data).not.toHaveProperty('statut');
      expect(call[0].data).not.toHaveProperty('statut_avant_blocage');
    }
  });

  it('trace un mouvement par lot, en nommant la palette', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(palette() as any);

    await logisticUnitService.moveLogisticUnit('palette-1', ORG, USER, 'frigo-B');

    expect(prisma.batch_Mouvement.createMany).toHaveBeenCalledTimes(1);
    const data = vi.mocked(prisma.batch_Mouvement.createMany).mock.calls[0][0].data;

    expect(data).toHaveLength(2);
    expect(data).toContainEqual(
      expect.objectContaining({
        id_lot: 'lot-1',
        type_action: 'DEPLACEMENT',
        // La quantité posée sur CETTE palette (30), pas le stock total du lot (100) : sinon un lot
        // réparti sur deux palettes voit tout son stock déplacé deux fois dans sa frise.
        quantite: 30,
        metadata: expect.objectContaining({
          from: 'frigo-A',
          to: 'frigo-B',
          sscc: '380123400000000428',
        }),
      })
    );
  });

  it('scelle UN maillon d’audit pour le geste, pas un par lot', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(palette() as any);

    await logisticUnitService.moveLogisticUnit('palette-1', ORG, USER, 'frigo-B');

    expect(auditService.logAction).toHaveBeenCalledTimes(1);
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        userId: USER,
        action: 'MOVE_LOGISTIC_UNIT',
        entity: 'Logistic_Unit',
        entityId: 'palette-1',
      }),
      expect.anything()
    );
  });

  it('emmène aussi un lot en quarantaine — évacuer une palette d’un frigo en panne est le cas d’usage', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(palette('BLOQUE') as any);

    const result = await logisticUnitService.moveLogisticUnit('palette-1', ORG, USER, 'frigo-B');

    expect(result.lots_deplaces).toBe(2);
  });

  it('refuse (409) si un lot de la palette est sous rappel — rien ne part à moitié', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(palette('ALERTE') as any);

    const action = logisticUnitService.moveLogisticUnit('palette-1', ORG, USER, 'frigo-B');

    await expect(action).rejects.toMatchObject({ status: 409 });
    expect(prisma.batch.updateMany).not.toHaveBeenCalled();
  });

  /**
   * Le contrat annoncé est « si un seul lot ne peut pas suivre, rien ne bouge ». Tant que la garde
   * ne portait que sur les lots à DÉPLACER, un lot sous rappel déjà posé à la destination passait
   * au travers : le contrat était vrai ou faux selon la position initiale des lots.
   */
  it('refuse (409) même si le lot sous rappel est DÉJÀ à la destination', async () => {
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue({
      id: 'palette-1',
      organization_id: ORG,
      sscc: '380123400000000428',
      contenu: [
        {
          id_lot: 'lot-rappele',
          quantite: 10,
          unite: 'kg',
          lot: {
            id: 'lot-rappele',
            lot_number: '260729-RAPPEL',
            statut: 'ALERTE',
            version: 1,
            // Déjà en place : il n'entre donc PAS dans les lots à déplacer.
            id_materiel_actuel: 'frigo-B',
          },
        },
        {
          id_lot: 'lot-2',
          quantite: 20,
          unite: 'kg',
          lot: {
            id: 'lot-2',
            lot_number: '260729-BBBBBB',
            statut: 'EN_STOCK',
            version: 1,
            id_materiel_actuel: 'frigo-A',
          },
        },
      ],
    } as never);

    const action = logisticUnitService.moveLogisticUnit('palette-1', ORG, USER, 'frigo-B');

    await expect(action).rejects.toMatchObject({ status: 409 });
    expect(prisma.batch.updateMany).not.toHaveBeenCalled();
  });

  it('refuse (400) une destination qui n’est pas un emplacement de stockage', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(palette() as any);
    vi.mocked(prisma.equipment.findFirst).mockResolvedValue({
      id: 'cuve-1',
      organization_id: ORG,
      type: 'CUVE',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const action = logisticUnitService.moveLogisticUnit('palette-1', ORG, USER, 'cuve-1');

    await expect(action).rejects.toMatchObject({ status: 400 });
    expect(prisma.batch.updateMany).not.toHaveBeenCalled();
  });

  it('refuse (404) une palette d’une autre organisation', async () => {
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(null);

    const action = logisticUnitService.moveLogisticUnit('palette-1', ORG, USER, 'frigo-B');

    await expect(action).rejects.toMatchObject({ status: 404 });
    expect(prisma.logistic_Unit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'palette-1', organization_id: ORG } })
    );
  });

  it('refuse (409) si l’état d’un lot a changé pendant le geste (verrou optimiste)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(palette() as any);
    vi.mocked(prisma.batch.updateMany).mockResolvedValue({ count: 0 } as never);
    // L'état frais montre un lot passé sous rappel : la position n'a pas bougé, l'alarme est juste.
    vi.mocked(prisma.batch.findFirst).mockResolvedValue({
      statut: 'ALERTE',
      id_materiel_actuel: 'frigo-A',
    } as never);

    const action = logisticUnitService.moveLogisticUnit('palette-1', ORG, USER, 'frigo-B');

    await expect(action).rejects.toMatchObject({ status: 409 });
  });

  /**
   * Double appui sur le bouton, ou retry réseau : la première requête a tout rangé, la seconde
   * perd le verrou optimiste. Alarmer l'opérateur alors que le geste a RÉUSSI l'envoie rescanner
   * la palette pour rien — c'est le cas que ce chemin est censé couvrir.
   */
  it('n’alarme pas quand le lot est déjà arrivé à destination entre-temps', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(palette() as any);
    vi.mocked(prisma.batch.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.batch.findFirst).mockResolvedValue({
      statut: 'EN_STOCK',
      id_materiel_actuel: 'frigo-B',
    } as never);

    const result = await logisticUnitService.moveLogisticUnit('palette-1', ORG, USER, 'frigo-B');

    expect(result.lots_deplaces).toBe(0);
    expect(prisma.batch_Mouvement.createMany).not.toHaveBeenCalled();
    // Rien n'a bougé : pas de maillon scellant un « rangement de zéro lot » dans la chaîne WORM.
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  /**
   * Le lot est bien arrivé à destination, mais un rappel s'est intercalé : la version a changé
   * pour une raison qui n'a rien à voir avec la position. Accepter en silence scellerait un
   * maillon d'audit affirmant qu'on a rangé un lot devenu intouchable.
   */
  it('alarme quand le lot est à destination mais qu’un rappel s’est intercalé', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(palette() as any);
    vi.mocked(prisma.batch.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.batch.findFirst).mockResolvedValue({
      statut: 'ALERTE',
      id_materiel_actuel: 'frigo-B',
    } as never);

    const action = logisticUnitService.moveLogisticUnit('palette-1', ORG, USER, 'frigo-B');

    await expect(action).rejects.toMatchObject({ status: 409 });
  });

  it('no-op si la palette est déjà à cet emplacement (aucune écriture)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(palette() as any);

    const result = await logisticUnitService.moveLogisticUnit('palette-1', ORG, USER, 'frigo-A');

    expect(result.lots_deplaces).toBe(0);
    expect(prisma.batch.updateMany).not.toHaveBeenCalled();
    expect(prisma.batch_Mouvement.createMany).not.toHaveBeenCalled();
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  /**
   * Le raccourci d'idempotence répondait « Palette rangée. » AVANT de vérifier la destination :
   * un UUID inexistant, un matériel d'une autre organisation ou une cuve passaient tous.
   */
  it('valide la destination même quand il n’y a rien à déplacer', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(palette() as any);
    vi.mocked(prisma.equipment.findFirst).mockResolvedValue(null);

    const action = logisticUnitService.moveLogisticUnit('palette-1', ORG, USER, 'frigo-A');

    await expect(action).rejects.toMatchObject({ status: 404 });
  });

  it('refuse (409) de « ranger » une palette vide plutôt que de confirmer un rangement fictif', async () => {
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue({
      id: 'palette-1',
      organization_id: ORG,
      sscc: '380123400000000428',
      contenu: [],
    } as never);

    const action = logisticUnitService.moveLogisticUnit('palette-1', ORG, USER, 'frigo-B');

    await expect(action).rejects.toMatchObject({ status: 409 });
  });
});
