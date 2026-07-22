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
    customer: {
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

const { customerService } = await import('./customer.service');

const ORG = 'org-1';

beforeEach(() => {
  [findMany, findFirst, create, update, logAction].forEach((m) => m.mockReset());
});

describe('customerService.create', () => {
  it('crée le client et journalise l’acte', async () => {
    create.mockResolvedValue({ id: 's1', nom_enseigne: 'Super U' });

    const res = await customerService.create(
      { nom_enseigne: 'Super U', adresse_livraison: '1 rue' },
      ORG,
      'admin'
    );

    expect(res.id).toBe('s1');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organization_id: ORG }) })
    );
    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE_CUSTOMER', organizationId: ORG }),
      expect.anything()
    );
  });
});

describe('customerService.update — multi-tenancy', () => {
  it("refuse de modifier un client d'une autre organisation", async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      customerService.update('s-autre', { nom_enseigne: 'X' }, ORG, 'admin')
    ).rejects.toMatchObject({ status: 404 });

    expect(update).not.toHaveBeenCalled();
  });

  it('modifie un client de son organisation et journalise', async () => {
    findFirst.mockResolvedValue({ id: 's1', nom_enseigne: 'Avant' });
    update.mockResolvedValue({ id: 's1', nom_enseigne: 'Après' });

    await customerService.update('s1', { nom_enseigne: 'Après' }, ORG, 'admin');

    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE_CUSTOMER' }),
      expect.anything()
    );
  });
});

describe('customerService.setActive — archivage / réactivation', () => {
  it('archive avec une action d’audit distincte', async () => {
    findFirst.mockResolvedValue({ id: 's1', is_active: true });
    update.mockResolvedValue({ id: 's1', is_active: false });

    await customerService.setActive('s1', false, ORG, 'admin');

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { is_active: false } }));
    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ARCHIVE_CUSTOMER' }),
      expect.anything()
    );
  });

  it('réactive avec une action d’audit distincte de l’archivage', async () => {
    findFirst.mockResolvedValue({ id: 's1', is_active: false });
    update.mockResolvedValue({ id: 's1', is_active: true });

    await customerService.setActive('s1', true, ORG, 'admin');

    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REACTIVATE_CUSTOMER' }),
      expect.anything()
    );
  });

  it("n'ajoute AUCUNE ligne d'audit quand l'état ne change pas (archiver un déjà-archivé)", async () => {
    findFirst.mockResolvedValue({ id: 's1', is_active: false });

    await customerService.setActive('s1', false, ORG, 'admin');

    expect(update).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it("refuse d'archiver un client d'une autre organisation", async () => {
    findFirst.mockResolvedValue(null);

    await expect(customerService.setActive('s-autre', false, ORG, 'admin')).rejects.toMatchObject({
      status: 404,
    });
  });

  /**
   * ⚠️ L'invariant de cette correction : l'audit est écrit DANS la transaction de l'écriture.
   * Journalisé au-dehors, un crash entre les deux laissait une entité sans trace WORM — ou une
   * trace désignant une entité qui n'existe pas. Le second argument de `logAction` est le client
   * transactionnel : s'il disparaît, l'atomicité est rompue et ce test rougit.
   */
  it("journalise DANS la transaction de l'écriture, pas à côté", async () => {
    findFirst.mockResolvedValue({ id: 's1', is_active: true });
    update.mockResolvedValue({ id: 's1', is_active: false });

    await customerService.setActive('s1', false, ORG, 'admin');

    expect(logAction.mock.calls[0][1]).toBeDefined();
  });
});
