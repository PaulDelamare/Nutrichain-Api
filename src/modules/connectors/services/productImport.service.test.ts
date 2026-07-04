import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    unit: { findMany: vi.fn() },
    product: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { productImportService } from './productImport.service';
import { prisma } from '../../../shared/configs/prismaClient.config';

const orgId = 'org-1';
const header =
  'nom,code_gtin,categorie,duree_conservation_defaut,seuil_alerte_stock,unite_reference';

describe('productImportService.importProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.unit.findMany).mockResolvedValue([{ code: 'L' }, { code: 'kg' }] as never);
    vi.mocked(prisma.product.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.product.create).mockResolvedValue({} as never);
    vi.mocked(prisma.product.update).mockResolvedValue({} as never);
  });

  it('crée les produits valides et cloisonne par organisation', async () => {
    const csv = `${header}\nLait,3001234567890,Frais,30,10,L\nBeurre,3009876543210,Frais,60,5,kg`;

    const report = await productImportService.importProducts(orgId, csv);

    expect(report).toMatchObject({ total: 2, created: 2, updated: 0, errors: 0 });
    expect(prisma.product.create).toHaveBeenCalledTimes(2);
    const firstCreate = vi.mocked(prisma.product.create).mock.calls[0][0];
    expect(firstCreate.data).toMatchObject({ organization_id: orgId, code_gtin: '3001234567890' });
    // findFirst cloisonné à l'org
    expect(prisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organization_id: orgId, code_gtin: '3001234567890' } })
    );
  });

  it('met à jour un produit existant (idempotent par org+code_gtin, pas de doublon)', async () => {
    vi.mocked(prisma.product.findFirst).mockResolvedValue({ id: 'prod-existant' } as never);
    const csv = `${header}\nLait,3001234567890,Frais,30,10,L`;

    const report = await productImportService.importProducts(orgId, csv);

    expect(report).toMatchObject({ total: 1, created: 0, updated: 1, errors: 0 });
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'prod-existant' } })
    );
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('une ligne invalide est rapportée en erreur sans bloquer les lignes valides', async () => {
    // 2e ligne : gtin trop court → invalide
    const csv = `${header}\nLait,3001234567890,Frais,30,10,L\nMauvais,123,Frais,30,10,L`;

    const report = await productImportService.importProducts(orgId, csv);

    expect(report.created).toBe(1);
    expect(report.errors).toBe(1);
    const errorRow = report.results.find((r) => r.status === 'error');
    expect(errorRow?.line).toBe(2);
  });

  it('rejette un GTIN-12 (UPC-A) : seul GTIN-13/14 garantit une URN EPC correcte', async () => {
    const csv = `${header}\nSoda,345678901230,Boisson,180,10,L`;

    const report = await productImportService.importProducts(orgId, csv);

    expect(report.errors).toBe(1);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('rejette un GTIN non numérique de longueur plausible', async () => {
    const csv = `${header}\nLait,30012345678AB,Frais,30,10,L`;

    const report = await productImportService.importProducts(orgId, csv);

    expect(report.errors).toBe(1);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('rejette une unité inconnue (FK Unit) en erreur de ligne', async () => {
    const csv = `${header}\nLait,3001234567890,Frais,30,10,TONNE`;

    const report = await productImportService.importProducts(orgId, csv);

    expect(report.errors).toBe(1);
    expect(report.results[0].message).toContain('Unité inconnue');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });
});
