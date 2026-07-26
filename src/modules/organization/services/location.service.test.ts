import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMany = vi.fn();
const findFirst = vi.fn();
const create = vi.fn();
const update = vi.fn();
const logAction = vi.fn();

vi.mock('../../../shared/configs/prismaClient.config', () => {
  const mockPrisma: Record<string, unknown> = {
    // Les écritures passent par `retryableTransaction` : le mock rejoue le callback avec
    // lui-même en guise de client transactionnel.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: (cb: any) => cb(mockPrisma),
    location: {
      findMany: (...a: unknown[]) => findMany(...a),
      findFirst: (...a: unknown[]) => findFirst(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
  };
  return { prisma: mockPrisma, bdd: mockPrisma };
});
vi.mock('../../../shared/utils/audit/audit.service', () => ({
  auditService: { logAction: (...a: unknown[]) => logAction(...a) },
}));

const { locationService } = await import('./location.service');

const ORG = 'org-1';

beforeEach(() => {
  [findMany, findFirst, create, update, logAction].forEach((m) => m.mockReset());
});

describe('locationService.create', () => {
  it('crée le emplacement et journalise l’acte', async () => {
    create.mockResolvedValue({ id: 's1', nom: 'Quai A' });

    const res = await locationService.create({ nom: 'Quai A', type: 'RECEPTION' }, ORG, 'admin');

    expect(res.id).toBe('s1');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organization_id: ORG }) })
    );
    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE_LOCATION', organizationId: ORG }),
      expect.anything()
    );
  });
});

describe('locationService — cohérence du couple de coordonnées', () => {
  it('accepte une position complète et la transmet telle quelle', async () => {
    create.mockResolvedValue({ id: 's1' });

    await locationService.create(
      { nom: 'Quai A', type: 'RECEPTION', latitude: 48.83291, longitude: 2.28654 },
      ORG,
      'admin'
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ latitude: 48.83291, longitude: 2.28654 }),
      })
    );
  });

  it('refuse une création avec une latitude sans longitude', async () => {
    await expect(
      locationService.create({ nom: 'Quai A', type: 'RECEPTION', latitude: 48.83291 }, ORG, 'admin')
    ).rejects.toMatchObject({ status: 400 });

    expect(create).not.toHaveBeenCalled();
  });

  it("refuse d'effacer la seule latitude et de laisser une longitude orpheline en base", async () => {
    findFirst.mockResolvedValue({ id: 's1', latitude: 48.83291, longitude: 2.28654 });

    await expect(
      locationService.update('s1', { latitude: null }, ORG, 'admin')
    ).rejects.toMatchObject({ status: 400 });

    expect(update).not.toHaveBeenCalled();
  });

  it('efface la position quand les deux coordonnées sont mises à null', async () => {
    findFirst.mockResolvedValue({ id: 's1', latitude: 48.83291, longitude: 2.28654 });
    update.mockResolvedValue({ id: 's1', latitude: null, longitude: null });

    await locationService.update('s1', { latitude: null, longitude: null }, ORG, 'admin');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { latitude: null, longitude: null } })
    );
  });

  it("refuse d'ajouter une longitude à un lieu qui n'a pas de latitude", async () => {
    findFirst.mockResolvedValue({ id: 's1', latitude: null, longitude: null });

    await expect(
      locationService.update('s1', { longitude: 2.28654 }, ORG, 'admin')
    ).rejects.toMatchObject({ status: 400 });
  });

  it('laisse renommer un lieu déjà positionné sans redemander ses coordonnées', async () => {
    findFirst.mockResolvedValue({ id: 's1', latitude: 48.83291, longitude: 2.28654 });
    update.mockResolvedValue({ id: 's1', nom: 'Quai B' });

    await locationService.update('s1', { nom: 'Quai B' }, ORG, 'admin');

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { nom: 'Quai B' } }));
  });
});

describe('locationService.update — multi-tenancy', () => {
  it("refuse de modifier un emplacement d'une autre organisation", async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      locationService.update('s-autre', { nom: 'X' }, ORG, 'admin')
    ).rejects.toMatchObject({ status: 404 });

    expect(update).not.toHaveBeenCalled();
  });

  it('modifie un emplacement de son organisation et journalise', async () => {
    findFirst.mockResolvedValue({ id: 's1', nom: 'Avant' });
    update.mockResolvedValue({ id: 's1', nom: 'Après' });

    await locationService.update('s1', { nom: 'Après' }, ORG, 'admin');

    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE_LOCATION' }),
      expect.anything()
    );
  });
});

describe('locationService.setActive — archivage / réactivation', () => {
  it('archive avec une action d’audit distincte', async () => {
    findFirst.mockResolvedValue({ id: 's1', is_active: true });
    update.mockResolvedValue({ id: 's1', is_active: false });

    await locationService.setActive('s1', false, ORG, 'admin');

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { is_active: false } }));
    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ARCHIVE_LOCATION' }),
      expect.anything()
    );
  });

  it('réactive avec une action d’audit distincte de l’archivage', async () => {
    findFirst.mockResolvedValue({ id: 's1', is_active: false });
    update.mockResolvedValue({ id: 's1', is_active: true });

    await locationService.setActive('s1', true, ORG, 'admin');

    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REACTIVATE_LOCATION' }),
      expect.anything()
    );
  });

  it("refuse d'archiver un emplacement d'une autre organisation", async () => {
    findFirst.mockResolvedValue(null);

    await expect(locationService.setActive('s-autre', false, ORG, 'admin')).rejects.toMatchObject({
      status: 404,
    });
  });
});
