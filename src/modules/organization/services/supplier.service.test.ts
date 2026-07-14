import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMany = vi.fn();
const findFirst = vi.fn();
const create = vi.fn();
const update = vi.fn();
const logAction = vi.fn();

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    supplier: {
      findMany: (...a: unknown[]) => findMany(...a),
      findFirst: (...a: unknown[]) => findFirst(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));
vi.mock('../../../shared/utils/audit/audit.service', () => ({
  auditService: { logAction: (...a: unknown[]) => logAction(...a) },
}));

const { supplierService } = await import('./supplier.service');

const ORG = 'org-1';

beforeEach(() => {
  [findMany, findFirst, create, update, logAction].forEach((m) => m.mockReset());
});

describe('supplierService.create', () => {
  it('crée le fournisseur et journalise l’acte', async () => {
    create.mockResolvedValue({ id: 's1', nom_ferme: 'Ferme A' });

    const res = await supplierService.create(
      { nom_ferme: 'Ferme A', adresse_siege: '1 rue' },
      ORG,
      'admin'
    );

    expect(res.id).toBe('s1');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organization_id: ORG }) })
    );
    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE_SUPPLIER', organizationId: ORG })
    );
  });
});

describe('supplierService.update — multi-tenancy', () => {
  it("refuse de modifier un fournisseur d'une autre organisation", async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      supplierService.update('s-autre', { nom_ferme: 'X' }, ORG, 'admin')
    ).rejects.toMatchObject({ status: 404 });

    expect(update).not.toHaveBeenCalled();
  });

  it('modifie un fournisseur de son organisation et journalise', async () => {
    findFirst.mockResolvedValue({ id: 's1', nom_ferme: 'Avant' });
    update.mockResolvedValue({ id: 's1', nom_ferme: 'Après' });

    await supplierService.update('s1', { nom_ferme: 'Après' }, ORG, 'admin');

    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE_SUPPLIER' }));
  });
});

describe('supplierService.setActive — archivage / réactivation', () => {
  it('archive avec une action d’audit distincte', async () => {
    findFirst.mockResolvedValue({ id: 's1', is_active: true });
    update.mockResolvedValue({ id: 's1', is_active: false });

    await supplierService.setActive('s1', false, ORG, 'admin');

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { is_active: false } }));
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'ARCHIVE_SUPPLIER' }));
  });

  it('réactive avec une action d’audit distincte de l’archivage', async () => {
    findFirst.mockResolvedValue({ id: 's1', is_active: false });
    update.mockResolvedValue({ id: 's1', is_active: true });

    await supplierService.setActive('s1', true, ORG, 'admin');

    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REACTIVATE_SUPPLIER' })
    );
  });

  it("n'ajoute AUCUNE ligne d'audit quand l'état ne change pas (archiver un déjà-archivé)", async () => {
    findFirst.mockResolvedValue({ id: 's1', is_active: false });

    await supplierService.setActive('s1', false, ORG, 'admin');

    expect(update).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it("refuse d'archiver un fournisseur d'une autre organisation", async () => {
    findFirst.mockResolvedValue(null);

    await expect(supplierService.setActive('s-autre', false, ORG, 'admin')).rejects.toMatchObject({
      status: 404,
    });
  });
});
