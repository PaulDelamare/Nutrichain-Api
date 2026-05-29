import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Alert } from '@prisma/client';
import { alertService } from './alert.service';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { auditService } from '../../../shared/utils/audit/audit.service';

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    $transaction: vi.fn(),
    alert: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      findFirstOrThrow: vi.fn(),
    },
  },
}));

vi.mock('../../../shared/utils/audit/audit.service', () => ({
  auditService: {
    logAction: vi.fn(),
  },
}));

const orgId = 'org-123';
const userId = 'user-resolver-123';
const alertId = 'alert-abc';

const buildAlert = (overrides: Partial<Alert> = {}): Alert =>
  ({
    id: alertId,
    organization_id: orgId,
    type: 'TEMP_EXCURSION',
    niveau_gravite: 'PANIC',
    message: 'Excursion thermique frigo NORD-001',
    id_materiel: 'eq-1',
    related_entity: 'Equipment',
    related_id: 'eq-1',
    statut: 'ACTIVE',
    created_at: new Date('2026-05-28T08:00:00Z'),
    resolved_by: null,
    resolved_at: null,
    ...overrides,
  }) as Alert;

describe('alertService.resolveAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // $transaction forward le callback au prisma mock + préserve les args
    vi.mocked(prisma.$transaction).mockImplementation(
      (cb: (tx: unknown) => Promise<unknown>) => cb(prisma) as never
    );
    vi.mocked(auditService.logAction).mockResolvedValue({} as never);
  });

  it('1. happy path : Alert ACTIVE → transitionne en RESOLVED, audit logué 1× avec tx', async () => {
    const alert = buildAlert();
    vi.mocked(prisma.alert.updateMany).mockResolvedValue({ count: 1 });
    const updated = buildAlert({
      statut: 'RESOLVED',
      resolved_by: userId,
      resolved_at: new Date('2026-05-28T09:00:00Z'),
    });
    vi.mocked(prisma.alert.findFirstOrThrow).mockResolvedValue(updated);

    const result = await alertService.resolveAlert({ alert, userId });

    expect(result.alreadyResolved).toBe(false);
    expect(result.alert.statut).toBe('RESOLVED');
    expect(result.alert.resolved_by).toBe(userId);
    expect(result.alert.resolved_at).toBeInstanceOf(Date);
    expect(prisma.alert.updateMany).toHaveBeenCalledWith({
      where: { id: alertId, statut: 'ACTIVE' },
      data: expect.objectContaining({
        statut: 'RESOLVED',
        resolved_by: userId,
        resolved_at: expect.any(Date),
      }),
    });
    expect(auditService.logAction).toHaveBeenCalledTimes(1);
    // Le 2e arg est la tx (forwarded prisma mock)
    expect(vi.mocked(auditService.logAction).mock.calls[0][1]).toBe(prisma);
  });

  it("2. idempotent (count === 0 dès l'updateMany) : retour alreadyResolved, AUCUN audit", async () => {
    const alert = buildAlert({
      statut: 'RESOLVED',
      resolved_by: 'someone-else',
      resolved_at: new Date('2026-05-28T07:00:00Z'),
    });
    vi.mocked(prisma.alert.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.alert.findFirst).mockResolvedValue(alert);

    const result = await alertService.resolveAlert({ alert, userId });

    expect(result.alreadyResolved).toBe(true);
    expect(result.alert.statut).toBe('RESOLVED');
    expect(auditService.logAction).toHaveBeenCalledTimes(0);
  });

  it('3. race idempotente : winner audit 1×, loser audit 0× (2 callers concurrents)', async () => {
    const alert = buildAlert();
    // Winner : count === 1
    vi.mocked(prisma.alert.updateMany).mockResolvedValueOnce({ count: 1 });
    vi.mocked(prisma.alert.findFirstOrThrow).mockResolvedValueOnce(
      buildAlert({ statut: 'RESOLVED', resolved_by: userId, resolved_at: new Date() })
    );
    // Loser : count === 0 (le winner a déjà résolu)
    vi.mocked(prisma.alert.updateMany).mockResolvedValueOnce({ count: 0 });
    vi.mocked(prisma.alert.findFirst).mockResolvedValueOnce(
      buildAlert({ statut: 'RESOLVED', resolved_by: userId, resolved_at: new Date() })
    );

    const winner = await alertService.resolveAlert({ alert, userId });
    const loser = await alertService.resolveAlert({ alert, userId: 'user-loser' });

    expect(winner.alreadyResolved).toBe(false);
    expect(loser.alreadyResolved).toBe(true);
    // Exactement UN audit (winner uniquement)
    expect(auditService.logAction).toHaveBeenCalledTimes(1);
  });

  it('4. oldValue = snapshot complet pré-update (statut, resolved_by, resolved_at), pas un littéral', async () => {
    const previousDate = new Date('2026-05-27T15:00:00Z');
    const alert = buildAlert({
      statut: 'ACTIVE',
      resolved_by: null,
      resolved_at: previousDate, // valeur arbitraire pour prouver qu'on lit l'argument
    });
    vi.mocked(prisma.alert.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.alert.findFirstOrThrow).mockResolvedValue(
      buildAlert({ statut: 'RESOLVED', resolved_by: userId, resolved_at: new Date() })
    );

    await alertService.resolveAlert({ alert, userId });

    const auditCall = vi.mocked(auditService.logAction).mock.calls[0][0];
    expect(auditCall.oldValue).toEqual({
      statut: 'ACTIVE',
      resolved_by: null,
      resolved_at: previousDate,
    });
  });

  it('5. newValue : statut RESOLVED + resolved_by === userId + resolved_at instanceof Date', async () => {
    const alert = buildAlert();
    const resolvedDate = new Date('2026-05-28T09:30:00Z');
    vi.mocked(prisma.alert.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.alert.findFirstOrThrow).mockResolvedValue(
      buildAlert({ statut: 'RESOLVED', resolved_by: userId, resolved_at: resolvedDate })
    );

    await alertService.resolveAlert({ alert, userId });

    const newValue = vi.mocked(auditService.logAction).mock.calls[0][0].newValue as Record<
      string,
      unknown
    >;
    expect(newValue.statut).toBe('RESOLVED');
    expect(newValue.resolved_by).toBe(userId);
    expect(newValue.resolved_at).toBeInstanceOf(Date);
  });

  it('6. newValue.note === <string> quand note fournie', async () => {
    const alert = buildAlert();
    vi.mocked(prisma.alert.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.alert.findFirstOrThrow).mockResolvedValue(
      buildAlert({ statut: 'RESOLVED', resolved_by: userId, resolved_at: new Date() })
    );

    await alertService.resolveAlert({
      alert,
      userId,
      note: 'Nettoyage capteur frigo NORD-001 effectué.',
    });

    const newValue = vi.mocked(auditService.logAction).mock.calls[0][0].newValue as Record<
      string,
      unknown
    >;
    expect(newValue.note).toBe('Nettoyage capteur frigo NORD-001 effectué.');
  });

  it('7. newValue.note === null (pas undefined) quand note absente', async () => {
    const alert = buildAlert();
    vi.mocked(prisma.alert.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.alert.findFirstOrThrow).mockResolvedValue(
      buildAlert({ statut: 'RESOLVED', resolved_by: userId, resolved_at: new Date() })
    );

    await alertService.resolveAlert({ alert, userId });

    const newValue = vi.mocked(auditService.logAction).mock.calls[0][0].newValue as Record<
      string,
      unknown
    >;
    expect(newValue.note).toBeNull();
    expect(newValue.note).not.toBeUndefined();
  });

  it('8. audit failure → service rethrow (rollback Postgres garanti par rejection dans $transaction)', async () => {
    const alert = buildAlert();
    vi.mocked(prisma.alert.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.alert.findFirstOrThrow).mockResolvedValue(
      buildAlert({ statut: 'RESOLVED', resolved_by: userId, resolved_at: new Date() })
    );
    vi.mocked(auditService.logAction).mockRejectedValue(new Error('chain hash conflict'));

    await expect(alertService.resolveAlert({ alert, userId })).rejects.toThrow(
      'chain hash conflict'
    );
    // updateMany a bien été appelé (la rejection vient de l'audit)
    expect(prisma.alert.updateMany).toHaveBeenCalledTimes(1);
    expect(auditService.logAction).toHaveBeenCalledTimes(1);
  });

  it('9. transaction options literal : isolationLevel Serializable + timeout 10000', async () => {
    const alert = buildAlert();
    vi.mocked(prisma.alert.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.alert.findFirstOrThrow).mockResolvedValue(
      buildAlert({ statut: 'RESOLVED', resolved_by: userId, resolved_at: new Date() })
    );

    await alertService.resolveAlert({ alert, userId });

    const txCall = vi.mocked(prisma.$transaction).mock.calls[0];
    const opts = txCall[1] as { isolationLevel?: string; timeout?: number };
    expect(opts).toBeDefined();
    expect(opts.isolationLevel).toBe('Serializable');
    expect(opts.timeout).toBe(10_000);
  });

  it('10. PRODUCT_RECALL propagé : result.alert.type est conservé tel quel', async () => {
    const alert = buildAlert({ type: 'PRODUCT_RECALL' });
    vi.mocked(prisma.alert.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.alert.findFirstOrThrow).mockResolvedValue(
      buildAlert({
        type: 'PRODUCT_RECALL',
        statut: 'RESOLVED',
        resolved_by: userId,
        resolved_at: new Date(),
      })
    );

    const result = await alertService.resolveAlert({ alert, userId });

    expect(result.alert.type).toBe('PRODUCT_RECALL');
  });

  it('11. self-resolve par créateur : aucun branchement spécial, même flow', async () => {
    const creatorId = 'user-creator-xyz';
    const alert = buildAlert();
    vi.mocked(prisma.alert.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.alert.findFirstOrThrow).mockResolvedValue(
      buildAlert({ statut: 'RESOLVED', resolved_by: creatorId, resolved_at: new Date() })
    );

    const result = await alertService.resolveAlert({ alert, userId: creatorId });

    expect(result.alreadyResolved).toBe(false);
    expect(result.alert.resolved_by).toBe(creatorId);
    expect(auditService.logAction).toHaveBeenCalledTimes(1);
  });

  it('12. note avec emoji + chars accentués + RTL : pass-through intacte dans audit', async () => {
    const alert = buildAlert();
    vi.mocked(prisma.alert.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.alert.findFirstOrThrow).mockResolvedValue(
      buildAlert({ statut: 'RESOLVED', resolved_by: userId, resolved_at: new Date() })
    );
    const exoticNote = 'Nettoyage ✅ effectué — frigo é à ç ñ 你好 שלום';

    await alertService.resolveAlert({ alert, userId, note: exoticNote });

    const newValue = vi.mocked(auditService.logAction).mock.calls[0][0].newValue as Record<
      string,
      unknown
    >;
    expect(newValue.note).toBe(exoticNote);
  });
});
