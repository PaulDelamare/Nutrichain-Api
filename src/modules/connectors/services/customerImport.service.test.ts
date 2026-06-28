import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    customer: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { customerImportService } from './customerImport.service';
import { prisma } from '../../../shared/configs/prismaClient.config';

const orgId = 'org-1';
const header = 'external_ref,nom_enseigne,email,contact_urgence,adresse_livraison,notes';

describe('customerImportService.importCustomers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.customer.create).mockResolvedValue({} as never);
    vi.mocked(prisma.customer.update).mockResolvedValue({} as never);
  });

  it('crée les clients valides (avec email) et cloisonne par organisation', async () => {
    const csv = `${header}\nERP-001,Magasin A,a@x.com,+33100000000,1 rue A,\nERP-002,Magasin B,b@x.com,,2 rue B,VIP`;

    const report = await customerImportService.importCustomers(orgId, csv);

    expect(report).toMatchObject({ total: 2, created: 2, errors: 0 });
    const firstCreate = vi.mocked(prisma.customer.create).mock.calls[0][0];
    expect(firstCreate.data).toMatchObject({
      organization_id: orgId,
      external_ref: 'ERP-001',
      email: 'a@x.com',
    });
    // cellule contact vide → undefined (champ optionnel absent), pas d'erreur
    const secondCreate = vi.mocked(prisma.customer.create).mock.calls[1][0];
    expect(secondCreate.data.contact_urgence).toBeUndefined();
  });

  it('met à jour un client existant (idempotent par org+external_ref)', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({ id: 'cust-1' } as never);
    const csv = `${header}\nERP-001,Magasin A,a@x.com,,1 rue A,`;

    const report = await customerImportService.importCustomers(orgId, csv);

    expect(report).toMatchObject({ total: 1, created: 0, updated: 1 });
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cust-1' } })
    );
    expect(prisma.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organization_id: orgId, external_ref: 'ERP-001' } })
    );
  });

  it('rejette un email invalide en erreur de ligne sans bloquer les valides', async () => {
    const csv = `${header}\nERP-001,Magasin A,a@x.com,,1 rue A,\nERP-002,Magasin B,pas-un-email,,2 rue B,`;

    const report = await customerImportService.importCustomers(orgId, csv);

    expect(report.created).toBe(1);
    expect(report.errors).toBe(1);
    expect(report.results.find((r) => r.status === 'error')?.line).toBe(2);
  });

  it('rejette une ligne sans external_ref ni enseigne', async () => {
    const csv = `${header}\n,,a@x.com,,,`;

    const report = await customerImportService.importCustomers(orgId, csv);

    expect(report.errors).toBe(1);
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });
});
