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
