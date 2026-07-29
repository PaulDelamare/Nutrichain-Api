import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logisticUnitService } from './logisticUnit.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { auditService } from '../../../../shared/utils/audit/audit.service';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    batch: { findMany: vi.fn(), updateMany: vi.fn() },
    batch_Mouvement: { create: vi.fn() },
    equipment: { findFirst: vi.fn() },
    logistic_Unit: { create: vi.fn(), findFirst: vi.fn() },
    logistic_Unit_Content: { createMany: vi.fn(), delete: vi.fn() },
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

    expect(prisma.batch_Mouvement.create).toHaveBeenCalledTimes(2);
    expect(prisma.batch_Mouvement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id_lot: 'lot-1',
        type_action: 'DEPLACEMENT',
        metadata: expect.objectContaining({
          from: 'frigo-A',
          to: 'frigo-B',
          sscc: '380123400000000428',
        }),
      }),
    });
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

    const action = logisticUnitService.moveLogisticUnit('palette-1', ORG, USER, 'frigo-B');

    await expect(action).rejects.toMatchObject({ status: 409 });
  });

  it('no-op si la palette est déjà à cet emplacement (aucune écriture)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.logistic_Unit.findFirst).mockResolvedValue(palette() as any);

    const result = await logisticUnitService.moveLogisticUnit('palette-1', ORG, USER, 'frigo-A');

    expect(result.lots_deplaces).toBe(0);
    expect(prisma.batch.updateMany).not.toHaveBeenCalled();
    expect(prisma.batch_Mouvement.create).not.toHaveBeenCalled();
    expect(auditService.logAction).not.toHaveBeenCalled();
  });
});
