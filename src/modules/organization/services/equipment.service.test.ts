import { describe, it, expect, vi, beforeEach } from 'vitest';
import { equipmentService } from './equipment.service';
import { prisma } from '../../../shared/configs/prismaClient.config';

vi.mock('../../../shared/configs/prismaClient.config', () => {
  const prisma = {
    location: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    equipment: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    // Callback (retryableTransaction, création + audit atomiques) OU tableau (lectures paginées
    // comme listLocationsPaginated ⇒ Promise.all).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma))),
  };
  return { prisma };
});

vi.mock('../../../shared/utils/audit/audit.service', () => ({
  auditService: { logAction: vi.fn() },
}));

const ORG = 'org-1';
const USER = 'user-1';

const LOCATION = { id: 'lieu-1', organization_id: ORG, nom: 'Chambre froide A', is_active: true };

describe('equipmentService.createEquipment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rattache le matériel au lieu et lui donne une étiquette scannable', async () => {
    // Sans étiquette, l'opérateur ne peut pas scanner l'emplacement du lot — et un lot sans
    // emplacement n'est JAMAIS mis en quarantaine si son frigo dérive.
    vi.mocked(prisma.location.findFirst).mockResolvedValue(LOCATION as never);
    vi.mocked(prisma.equipment.create).mockImplementation((async ({
      data,
    }: {
      data: Record<string, unknown>;
    }) => ({ id: 'eq-1', ...data })) as never);

    const created = await equipmentService.createEquipment({
      organization_id: ORG,
      created_by: USER,
      nom: 'Chambre froide B',
      type: 'FRIGO',
      id_lieu: LOCATION.id,
      temp_seuil_max: 4,
    });

    expect(created.qr_code_id).toMatch(/^EQP-[0-9A-F]{10}$/);

    const { data } = vi.mocked(prisma.equipment.create).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data).toMatchObject({ organization_id: ORG, id_lieu: LOCATION.id, type: 'FRIGO' });
  });

  it('refuse un lieu qui appartient à une autre organisation', async () => {
    // Cloisonnement multi-tenant : un identifiant de lieu deviné ne doit rien ouvrir.
    vi.mocked(prisma.location.findFirst).mockResolvedValue(null);

    await expect(
      equipmentService.createEquipment({
        organization_id: ORG,
        created_by: USER,
        nom: 'Frigo pirate',
        type: 'FRIGO',
        id_lieu: 'lieu-d-une-autre-org',
      })
    ).rejects.toMatchObject({ status: 400 });

    expect(prisma.equipment.create).not.toHaveBeenCalled();
  });

  it('trace la création dans le journal d’audit', async () => {
    const { auditService } = await import('../../../shared/utils/audit/audit.service');
    vi.mocked(prisma.location.findFirst).mockResolvedValue(LOCATION as never);
    vi.mocked(prisma.equipment.create).mockResolvedValue({ id: 'eq-1', nom: 'Frigo' } as never);

    await equipmentService.createEquipment({
      organization_id: ORG,
      created_by: USER,
      nom: 'Frigo',
      type: 'FRIGO',
      id_lieu: LOCATION.id,
    });

    // Dans la transaction : logAction reçoit la `tx` en second argument (audit atomique).
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE_EQUIPMENT', entity: 'Equipment', userId: USER }),
      expect.anything()
    );
  });
});

describe('equipmentService.getScannableLabel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rend l’étiquette existante du matériel', async () => {
    vi.mocked(prisma.equipment.findFirst).mockResolvedValue({
      id: 'eq-1',
      nom: 'Chambre froide A',
      qr_code_id: 'EQP-ABCDEF0123',
    } as never);

    const label = await equipmentService.getScannableLabel(ORG, 'eq-1');

    expect(label.code).toBe('EQP-ABCDEF0123');
    expect(prisma.equipment.update).not.toHaveBeenCalled();
  });

  it('lecture seule : ne mute JAMAIS la base (un GET ne doit rien écrire — #99)', async () => {
    // Avant, un qr_code_id absent déclenchait un update paresseux : un viewer mutait la base sur un
    // GET, sans audit. Le code est désormais toujours posé à la création / au seed / par migration.
    vi.mocked(prisma.equipment.findFirst).mockResolvedValue({
      nom: 'Chambre froide A',
      qr_code_id: 'EQP-ABCDEF0123',
    } as never);

    const label = await equipmentService.getScannableLabel(ORG, 'eq-1');

    expect(label.code).toBe('EQP-ABCDEF0123');
    expect(prisma.equipment.update).not.toHaveBeenCalled();
  });

  it('refuse un matériel d’une autre organisation', async () => {
    vi.mocked(prisma.equipment.findFirst).mockResolvedValue(null);

    await expect(equipmentService.getScannableLabel(ORG, 'eq-inconnu')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('equipmentService.listLocationsPaginated', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pagine (skip/take), trie par nom et renvoie { data, pagination }', async () => {
    vi.mocked(prisma.location.count).mockResolvedValue(42 as never);
    vi.mocked(prisma.location.findMany).mockResolvedValue([] as never);

    const res = await equipmentService.listLocationsPaginated(ORG, { page: 3, limit: 10 });

    expect(prisma.location.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organization_id: ORG }),
        orderBy: { nom: 'asc' },
        skip: 20,
        take: 10,
      })
    );
    expect(res.pagination).toEqual({ page: 3, limit: 10, total: 42, totalPages: 5 });
  });

  it('filtre par nom (contains insensible), type (exact) et statut (is_active)', async () => {
    vi.mocked(prisma.location.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.location.findMany).mockResolvedValue([] as never);

    await equipmentService.listLocationsPaginated(ORG, {
      nom: 'froid',
      type: 'Chambre froide',
      statut: 'archive',
    });

    expect(prisma.location.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          nom: { contains: 'froid', mode: 'insensitive' },
          type: 'Chambre froide',
          is_active: false,
        }),
      })
    );
  });
});
