import { describe, it, expect, vi, beforeEach } from 'vitest';
import { equipmentService } from './equipment.service';
import { prisma } from '../../../shared/configs/prismaClient.config';

vi.mock('../../../shared/configs/prismaClient.config', () => {
  const prisma = {
    location: { findFirst: vi.fn() },
    equipment: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    // Exécute le callback avec le mock lui-même comme `tx` : la création et l'audit sont
    // désormais atomiques (retryableTransaction). `tx.equipment.create` === `prisma.equipment.create`.
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
  };
  return { prisma };
});

vi.mock('../../../shared/utils/audit/audit.service', () => ({
  auditService: { logAction: vi.fn() },
}));

const ORG = 'org-1';
const USER = 'user-1';

const LIEU = { id: 'lieu-1', organization_id: ORG, nom: 'Chambre froide A', is_active: true };

describe('equipmentService.createEquipment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rattache le matériel au lieu et lui donne une étiquette scannable', async () => {
    // Sans étiquette, l'opérateur ne peut pas scanner l'emplacement du lot — et un lot sans
    // emplacement n'est JAMAIS mis en quarantaine si son frigo dérive.
    vi.mocked(prisma.location.findFirst).mockResolvedValue(LIEU as never);
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
      id_lieu: LIEU.id,
      temp_seuil_max: 4,
    });

    expect(created.qr_code_id).toMatch(/^EQP-[0-9A-F]{10}$/);

    const { data } = vi.mocked(prisma.equipment.create).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data).toMatchObject({ organization_id: ORG, id_lieu: LIEU.id, type: 'FRIGO' });
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
    vi.mocked(prisma.location.findFirst).mockResolvedValue(LIEU as never);
    vi.mocked(prisma.equipment.create).mockResolvedValue({ id: 'eq-1', nom: 'Frigo' } as never);

    await equipmentService.createEquipment({
      organization_id: ORG,
      created_by: USER,
      nom: 'Frigo',
      type: 'FRIGO',
      id_lieu: LIEU.id,
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

  it('attribue une étiquette au matériel qui n’en a pas encore', async () => {
    // Les matériels créés avant cette fonctionnalité n'ont pas d'étiquette : leur en donner
    // une à la première impression évite une migration et un parc à deux vitesses.
    vi.mocked(prisma.equipment.findFirst).mockResolvedValue({
      id: 'eq-1',
      nom: 'Chambre froide A',
      qr_code_id: null,
    } as never);
    vi.mocked(prisma.equipment.update).mockImplementation((async ({
      data,
    }: {
      data: { qr_code_id: string };
    }) => ({
      id: 'eq-1',
      nom: 'Chambre froide A',
      qr_code_id: data.qr_code_id,
    })) as never);

    const label = await equipmentService.getScannableLabel(ORG, 'eq-1');

    expect(label.code).toMatch(/^EQP-[0-9A-F]{10}$/);
    expect(prisma.equipment.update).toHaveBeenCalled();
  });

  it('refuse un matériel d’une autre organisation', async () => {
    vi.mocked(prisma.equipment.findFirst).mockResolvedValue(null);

    await expect(equipmentService.getScannableLabel(ORG, 'eq-inconnu')).rejects.toMatchObject({
      status: 404,
    });
  });
});
