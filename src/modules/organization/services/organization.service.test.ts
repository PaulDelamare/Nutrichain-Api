import { describe, it, expect, vi, beforeEach } from 'vitest';
import { organizationService } from './organization.service';
import { prisma } from '../../../shared/configs/prismaClient.config';

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    member: { findMany: vi.fn() },
    alert: { findMany: vi.fn() },
    audit_Log: { findMany: vi.fn() },
    qualityControl: { findMany: vi.fn() },
    batch: { findMany: vi.fn() },
    equipment: { findMany: vi.fn() },
    batch_Mouvement: { findMany: vi.fn() },
    supplier: { findMany: vi.fn() },
    customer: { findMany: vi.fn() },
    shipment: { findMany: vi.fn() },
  },
}));

const ORG = 'org-1';

describe('OrganizationService (façade de lecture pour le front)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listMembers : cloisonné par organizationId (camelCase Better-Auth) avec l utilisateur joint', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.member.findMany).mockResolvedValue([] as any);

    await organizationService.listMembers(ORG);

    expect(prisma.member.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG },
      include: {
        user: { select: { id: true, email: true, name: true, twoFactorEnabled: true } },
      },
    });
  });

  it('listAlerts : cloisonné, triées les plus récentes d abord (le front filtre type/statut lui-même)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.alert.findMany).mockResolvedValue([] as any);

    await organizationService.listAlerts(ORG);

    expect(prisma.alert.findMany).toHaveBeenCalledWith({
      where: { organization_id: ORG },
      orderBy: { created_at: 'desc' },
    });
  });

  it('listAuditLogs : cloisonné, limité, du plus récent au plus ancien', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.audit_Log.findMany).mockResolvedValue([] as any);

    await organizationService.listAuditLogs(ORG, 50);

    expect(prisma.audit_Log.findMany).toHaveBeenCalledWith({
      where: { organization_id: ORG },
      orderBy: { horodatage: 'desc' },
      take: 50,
    });
  });

  it('listQualityControls : cloisonné, lot et produit joints (forme attendue par le front)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.qualityControl.findMany).mockResolvedValue([] as any);

    await organizationService.listQualityControls(ORG);

    expect(prisma.qualityControl.findMany).toHaveBeenCalledWith({
      where: { organization_id: ORG },
      include: { lot: { select: { id: true, produit: { select: { nom: true } } } } },
      orderBy: { date_test: 'desc' },
    });
  });

  it('listQuarantineBatches : uniquement les lots BLOQUE (quarantaine HACCP réelle)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch.findMany).mockResolvedValue([] as any);

    await organizationService.listQuarantineBatches(ORG);

    expect(prisma.batch.findMany).toHaveBeenCalledWith({
      where: { organization_id: ORG, statut: 'BLOQUE' },
      include: { produit: { select: { nom: true } } },
      orderBy: { date_creation: 'desc' },
    });
  });

  it('listEquipment : cloisonné, lieu joint', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.equipment.findMany).mockResolvedValue([] as any);

    await organizationService.listEquipment(ORG);

    expect(prisma.equipment.findMany).toHaveBeenCalledWith({
      where: { organization_id: ORG },
      include: { lieu: { select: { nom: true } } },
    });
  });

  it("listMovements : cloisonné VIA le lot (Batch_Mouvement n'a pas d'organization_id direct)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch_Mouvement.findMany).mockResolvedValue([] as any);

    // Sans `revealAuthor`, l'identité de l'auteur n'est PAS jointe : un opérateur voit l'historique
    // matière du lot, jamais qui a fait chaque geste (donnée personnelle réservée à l'admin).
    await organizationService.listMovements(ORG, { limit: 100 });

    expect(prisma.batch_Mouvement.findMany).toHaveBeenCalledWith({
      where: { lot: { organization_id: ORG } },
      include: {
        lot: { select: { id: true, produit: { select: { nom: true } } } },
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
  });

  it("listMovements : joint le nom de l'auteur UNIQUEMENT pour l'administration", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch_Mouvement.findMany).mockResolvedValue([] as any);

    await organizationService.listMovements(ORG, { limit: 100, revealAuthor: true });

    expect(prisma.batch_Mouvement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ user: { select: { name: true } } }),
      })
    );
  });

  it('listMovements : filtre par lot quand lotId est fourni (fiche lot)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.batch_Mouvement.findMany).mockResolvedValue([] as any);

    await organizationService.listMovements(ORG, { lotId: 'lot-42', limit: 10 });

    expect(prisma.batch_Mouvement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lot: { organization_id: ORG }, id_lot: 'lot-42' },
        take: 10,
      })
    );
  });

  it('listSuppliers / listCustomers : cloisonnés, triés par nom', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.supplier.findMany).mockResolvedValue([] as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.customer.findMany).mockResolvedValue([] as any);

    await organizationService.listSuppliers(ORG);
    await organizationService.listCustomers(ORG);

    expect(prisma.supplier.findMany).toHaveBeenCalledWith({
      where: { organization_id: ORG, is_active: true },
      orderBy: { nom_ferme: 'asc' },
    });
    expect(prisma.customer.findMany).toHaveBeenCalledWith({
      where: { organization_id: ORG, is_active: true },
      orderBy: { nom_enseigne: 'asc' },
    });
  });

  it('listShipments : cloisonné, client et lots liés joints, plus récentes d abord', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.shipment.findMany).mockResolvedValue([] as any);

    await organizationService.listShipments(ORG);

    expect(prisma.shipment.findMany).toHaveBeenCalledWith({
      where: { organization_id: ORG },
      include: {
        client: { select: { nom_enseigne: true } },
        liaisons: { select: { lot: { select: { id: true } } } },
      },
      orderBy: { date_envoi: 'desc' },
    });
  });
});
