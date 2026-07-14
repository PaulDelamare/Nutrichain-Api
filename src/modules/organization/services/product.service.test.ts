import { describe, it, expect, vi, beforeEach } from 'vitest';

const productFindFirst = vi.fn();
const productCreate = vi.fn();
const productUpdate = vi.fn();
const batchCount = vi.fn();
const logAction = vi.fn();

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    product: {
      findFirst: (...a: unknown[]) => productFindFirst(...a),
      create: (...a: unknown[]) => productCreate(...a),
      update: (...a: unknown[]) => productUpdate(...a),
    },
    batch: { count: (...a: unknown[]) => batchCount(...a) },
  },
}));
vi.mock('../../../shared/utils/audit/audit.service', () => ({
  auditService: { logAction: (...a: unknown[]) => logAction(...a) },
}));

const { productService } = await import('./product.service');

const ORG = 'org-1';
const INPUT = {
  nom: 'Yaourt nature',
  code_gtin: '3456789012345',
  categorie: 'Frais',
  duree_conservation_defaut: 30,
  seuil_alerte_stock: 10,
  unite_reference: 'KG',
};

beforeEach(() => {
  [productFindFirst, productCreate, productUpdate, batchCount, logAction].forEach((m) =>
    m.mockReset()
  );
});

describe('productService.create', () => {
  it('crée le produit et journalise', async () => {
    productFindFirst.mockResolvedValue(null); // pas de doublon de GTIN
    productCreate.mockResolvedValue({ id: 'p1', ...INPUT });

    const res = await productService.create(INPUT, ORG, 'admin');

    expect(res.id).toBe('p1');
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE_PRODUCT' }));
  });

  it('refuse un GTIN déjà utilisé dans l’organisation (409)', async () => {
    productFindFirst.mockResolvedValue({ id: 'deja' });

    await expect(productService.create(INPUT, ORG, 'admin')).rejects.toMatchObject({ status: 409 });
    expect(productCreate).not.toHaveBeenCalled();
  });
});

describe('productService.update — garde sur l’unité', () => {
  it("refuse de changer l'unité si des lots du produit existent (409)", async () => {
    productFindFirst.mockResolvedValue({ id: 'p1', unite_reference: 'KG' });
    batchCount.mockResolvedValue(3);

    await expect(
      productService.update('p1', { unite_reference: 'L' }, ORG, 'admin')
    ).rejects.toMatchObject({ status: 409 });
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("autorise le changement d'unité si aucun lot n'existe encore", async () => {
    productFindFirst.mockResolvedValue({ id: 'p1', unite_reference: 'KG' });
    batchCount.mockResolvedValue(0);
    productUpdate.mockResolvedValue({ id: 'p1', unite_reference: 'L' });

    await productService.update('p1', { unite_reference: 'L' }, ORG, 'admin');
    expect(productUpdate).toHaveBeenCalled();
  });

  it("modifie un autre champ sans toucher à l'unité, sans vérifier les lots", async () => {
    productFindFirst.mockResolvedValue({ id: 'p1', unite_reference: 'KG' });
    productUpdate.mockResolvedValue({ id: 'p1' });

    await productService.update('p1', { nom: 'Nouveau nom' }, ORG, 'admin');
    expect(batchCount).not.toHaveBeenCalled();
    expect(productUpdate).toHaveBeenCalled();
  });

  it("refuse un produit d'une autre organisation (404)", async () => {
    productFindFirst.mockResolvedValue(null);

    await expect(
      productService.update('p-autre', { nom: 'X' }, ORG, 'admin')
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('productService.setActive', () => {
  it('archive avec une action distincte, idempotent', async () => {
    productFindFirst.mockResolvedValue({ id: 'p1', is_active: true });
    productUpdate.mockResolvedValue({ id: 'p1', is_active: false });

    await productService.setActive('p1', false, ORG, 'admin');
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'ARCHIVE_PRODUCT' }));
  });

  it("n'écrit rien si l'état ne change pas", async () => {
    productFindFirst.mockResolvedValue({ id: 'p1', is_active: false });

    await productService.setActive('p1', false, ORG, 'admin');
    expect(productUpdate).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });
});
