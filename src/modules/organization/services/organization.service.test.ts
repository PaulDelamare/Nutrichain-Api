import { describe, it, expect, vi, beforeEach } from 'vitest';
import { organizationService } from './organization.service';
import { prisma } from '../../../shared/configs/prismaClient.config';

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    member: { findMany: vi.fn(), count: vi.fn() },
    alert: { findMany: vi.fn(), count: vi.fn() },
    audit_Log: { findMany: vi.fn() },
    qualityControl: { findMany: vi.fn() },
    batch: { findMany: vi.fn() },
    equipment: { findMany: vi.fn() },
    batch_Mouvement: { findMany: vi.fn() },
    supplier: { findMany: vi.fn() },
    customer: { findMany: vi.fn() },
    shipment: { findMany: vi.fn(), count: vi.fn() },
    // Forme tableau (lectures paginées comme listShipments) ⇒ Promise.all.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: vi.fn((ops: any[]) => Promise.all(ops)),
  },
}));

const ORG = 'org-1';

describe('OrganizationService (façade de lecture pour le front)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listMembers : cloisonné par organizationId (camelCase Better-Auth) avec l utilisateur joint', async () => {
    vi.mocked(prisma.member.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.member.findMany).mockResolvedValue([] as never);

    await organizationService.listMembers(ORG);

    expect(prisma.member.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG }),
        include: {
          user: { select: { id: true, email: true, name: true, twoFactorEnabled: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    );
  });

  it('listMembers : pagine (skip/take) et renvoie { data, pagination }', async () => {
    vi.mocked(prisma.member.count).mockResolvedValue(42 as never);
    vi.mocked(prisma.member.findMany).mockResolvedValue([] as never);

    const res = await organizationService.listMembers(ORG, { page: 3, limit: 10 });

    expect(prisma.member.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 })
    );
    expect(res.pagination).toEqual({ page: 3, limit: 10, total: 42, totalPages: 5 });
  });

  it('listMembers : filtre par e-mail (contains insensible) et par rôle', async () => {
    vi.mocked(prisma.member.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.member.findMany).mockResolvedValue([] as never);

    await organizationService.listMembers(ORG, { email: 'ana', role: 'operator' });

    expect(prisma.member.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG,
          role: 'operator',
          user: expect.objectContaining({
            email: { contains: 'ana', mode: 'insensitive' },
          }),
        }),
      })
    );
  });

  it('listMembers : « sans MFA » inclut les comptes jamais configurés (twoFactorEnabled null)', async () => {
    vi.mocked(prisma.member.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.member.findMany).mockResolvedValue([] as never);

    await organizationService.listMembers(ORG, { mfa: false });

    const where = vi.mocked(prisma.member.findMany).mock.calls.at(-1)?.[0]?.where as unknown as {
      user?: { OR?: unknown[] };
    };
    expect(where.user?.OR).toEqual([{ twoFactorEnabled: false }, { twoFactorEnabled: null }]);
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

  it('listRecalls : borne à la famille RAPPEL, pagine et renvoie { data, pagination }', async () => {
    vi.mocked(prisma.alert.count).mockResolvedValue(42 as never);
    vi.mocked(prisma.alert.findMany).mockResolvedValue([] as never);

    const res = await organizationService.listRecalls(ORG, { page: 3, limit: 10 });

    expect(prisma.alert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organization_id: ORG,
          type: { in: ['PRODUCT_RECALL', 'RAPPEL', 'RECALL_DEPTH_SATURATION'] },
        }),
        orderBy: { created_at: 'desc' },
        skip: 20,
        take: 10,
      })
    );
    expect(res.pagination).toEqual({ page: 3, limit: 10, total: 42, totalPages: 5 });
  });

  it('listRecalls : `en_cours` = ACTIVE, `cloture` = tout autre statut', async () => {
    vi.mocked(prisma.alert.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.alert.findMany).mockResolvedValue([] as never);

    await organizationService.listRecalls(ORG, { statut: 'en_cours' });
    expect(
      (vi.mocked(prisma.alert.findMany).mock.calls.at(-1)?.[0]?.where as { statut?: unknown }).statut
    ).toBe('ACTIVE');

    await organizationService.listRecalls(ORG, { statut: 'cloture' });
    expect(
      (vi.mocked(prisma.alert.findMany).mock.calls.at(-1)?.[0]?.where as { statut?: unknown }).statut
    ).toEqual({ not: 'ACTIVE' });
  });

  it('listRecalls : recherche libre `q` sur le message (contains insensible)', async () => {
    vi.mocked(prisma.alert.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.alert.findMany).mockResolvedValue([] as never);

    await organizationService.listRecalls(ORG, { q: 'listeria' });

    expect(prisma.alert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          message: { contains: 'listeria', mode: 'insensitive' },
        }),
      })
    );
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
      orderBy: [{ nom: 'asc' }, { id: 'asc' }],
    });
  });

  // Sans `orderBy`, Postgres rend les lignes dans l'ordre physique : écrire `temp_actuelle` sur un
  // matériel le déplace, et une liste sans tri se réordonne toute seule à chaque mesure IoT. Un
  // consommateur qui prend « le premier » — la courbe de la chaîne du froid le faisait — change de
  // matériel sans qu'aucune donnée métier n'ait bougé. Le départage par `id` est nécessaire : deux
  // matériels peuvent porter le même nom.
  it('listEquipment : ordre déterministe, départagé par id', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.equipment.findMany).mockResolvedValue([] as any);

    await organizationService.listEquipment(ORG);

    const { orderBy } = vi.mocked(prisma.equipment.findMany).mock.calls[0][0] ?? {};
    expect(Array.isArray(orderBy) && orderBy.at(-1)).toEqual({ id: 'asc' });
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

  it('listSuppliers / listCustomers : par défaut (opérateur), projection SANS données personnelles', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.supplier.findMany).mockResolvedValue([] as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.customer.findMany).mockResolvedValue([] as any);

    await organizationService.listSuppliers(ORG);
    await organizationService.listCustomers(ORG);

    // Fournisseur : identité métier seule. Ni contact_qualite ni adresse_siege ne remontent.
    expect(prisma.supplier.findMany).toHaveBeenCalledWith({
      where: { organization_id: ORG, is_active: true },
      select: { id: true, nom_ferme: true },
      orderBy: { nom_ferme: 'asc' },
    });
    // Client : identité + adresse de livraison (exploitation). Ni contact_urgence, ni email, ni notes.
    expect(prisma.customer.findMany).toHaveBeenCalledWith({
      where: { organization_id: ORG, is_active: true },
      select: { id: true, nom_enseigne: true, adresse_livraison: true },
      orderBy: { nom_enseigne: 'asc' },
    });
  });

  it('listSuppliers / listCustomers : revealPersonalData (admin) → ligne complète, includeArchived honoré', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.supplier.findMany).mockResolvedValue([] as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.customer.findMany).mockResolvedValue([] as any);

    await organizationService.listSuppliers(ORG, { includeArchived: true, revealPersonalData: true });
    await organizationService.listCustomers(ORG, { includeArchived: true, revealPersonalData: true });

    // Pas de `select` → toutes les colonnes (contact, adresse) ; pas de filtre is_active.
    expect(prisma.supplier.findMany).toHaveBeenCalledWith({
      where: { organization_id: ORG },
      orderBy: { nom_ferme: 'asc' },
    });
    expect(prisma.customer.findMany).toHaveBeenCalledWith({
      where: { organization_id: ORG },
      orderBy: { nom_enseigne: 'asc' },
    });
  });

  it('listShipments : cloisonné, client et lots liés joints, plus récentes d abord', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.shipment.findMany).mockResolvedValue([] as any);

    await organizationService.listShipments(ORG);

    expect(prisma.shipment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organization_id: ORG },
        orderBy: { date_envoi: 'desc' },
        select: expect.objectContaining({
          statut_livraison: true,
          date_livraison: true,
          client: { select: { nom_enseigne: true } },
          liaisons: { select: { lot: { select: { id: true } } } },
        }),
      })
    );
  });

  /**
   * Cette liste est ouverte à TOUS les rôles de lecture. Une projection explicite est la seule
   * chose qui empêche `delivered_by` — l'identité d'une personne — d'y arriver par le simple ajout
   * d'une colonne au modèle. Sans cette assertion, revenir à `include` ne ferait rougir personne.
   */
  it("listShipments : n'expose PAS l'auteur de la livraison", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.shipment.findMany).mockResolvedValue([] as any);

    await organizationService.listShipments(ORG);

    const appel = vi.mocked(prisma.shipment.findMany).mock.calls[0][0];
    expect(appel).not.toHaveProperty('include');
    expect(appel?.select).toBeDefined();
    expect(appel?.select).not.toHaveProperty('delivered_by');
    expect(appel?.select).not.toHaveProperty('delivered_by_label');
  });

  it('listShipments : pagine (skip/take) et renvoie { data, pagination }', async () => {
    vi.mocked(prisma.shipment.count).mockResolvedValue(42 as never);
    vi.mocked(prisma.shipment.findMany).mockResolvedValue([] as never);

    const res = await organizationService.listShipments(ORG, { page: 3, limit: 10 });

    expect(prisma.shipment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 })
    );
    expect(res.pagination).toEqual({ page: 3, limit: 10, total: 42, totalPages: 5 });
  });

  it('listShipments : filtre par référence, client et statut', async () => {
    vi.mocked(prisma.shipment.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.shipment.findMany).mockResolvedValue([] as never);

    await organizationService.listShipments(ORG, { ref: 'BL-9', client: 'cli-1', statut: 'LIVRE' });

    expect(prisma.shipment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shipment_id: { contains: 'BL-9', mode: 'insensitive' },
          id_client: 'cli-1',
          statut_livraison: 'LIVRE',
        }),
      })
    );
  });

  it('listShipments : filtre « un jour » sur date_envoi, borne [jour, lendemain[ UTC', async () => {
    vi.mocked(prisma.shipment.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.shipment.findMany).mockResolvedValue([] as never);

    await organizationService.listShipments(ORG, { date: '2026-07-31' });

    const where = vi.mocked(prisma.shipment.findMany).mock.calls.at(-1)?.[0]?.where as unknown as {
      date_envoi?: { gte: Date; lt: Date };
    };
    expect(where.date_envoi?.gte.toISOString()).toBe('2026-07-31T00:00:00.000Z');
    expect(where.date_envoi?.lt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });
});
