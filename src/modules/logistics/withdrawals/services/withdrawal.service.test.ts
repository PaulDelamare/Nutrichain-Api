import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { withdrawalService } from './withdrawal.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { auditService } from '../../../../shared/utils/audit/audit.service';
import { MOVEMENT_TYPES } from '../../constants/logistics.constants';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    $transaction: vi.fn(),
    batch: { findFirst: vi.fn() },
    customer: { findFirst: vi.fn() },
    liaison_Shipment: { aggregate: vi.fn() },
    withdrawal: { aggregate: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    batch_Mouvement: { create: vi.fn() },
  },
}));

vi.mock('../../../../shared/utils/audit/audit.service', () => ({
  auditService: { logAction: vi.fn() },
}));

const orgId = 'org-1';
const userId = 'user-1';
const batchId = 'lot-1';
const customerId = 'client-1';

const payload = {
  id_client: customerId,
  quantite: 10,
  motif: 'Rappel produit — retrait du rayon',
};

/** Le lot porte l'unité : elle n'est jamais reçue du client. */
const sourceBatch = { id: batchId, unite_code: 'KG' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation((cb: (tx: unknown) => Promise<unknown>) =>
    cb(prisma)
  );
  vi.mocked(prisma.batch.findFirst).mockResolvedValue(sourceBatch as never);
  vi.mocked(prisma.customer.findFirst).mockResolvedValue({ id: customerId } as never);
  vi.mocked(prisma.liaison_Shipment.aggregate).mockResolvedValue({
    _sum: { quantite_expediee: new Prisma.Decimal(40) },
  } as never);
  vi.mocked(prisma.withdrawal.aggregate).mockResolvedValue({
    _sum: { quantite: null },
  } as never);
  vi.mocked(prisma.withdrawal.create).mockResolvedValue({ id: 'retrait-1' } as never);
  vi.mocked(auditService.logAction).mockResolvedValue({} as never);
});

describe('withdrawalService.recordWithdrawal', () => {
  it('enregistre un retrait, avec l’unité du lot et l’auteur de la session', async () => {
    await withdrawalService.recordWithdrawal(batchId, orgId, userId, payload);

    const donnees = vi.mocked(prisma.withdrawal.create).mock.calls[0][0].data;
    expect(donnees).toMatchObject({
      organization_id: orgId,
      id_lot: batchId,
      id_client: customerId,
      unite: 'KG',
      retire_par: userId,
    });
  });

  /**
   * Le schéma VineJS n'accepte pas `unite`, mais le service ne doit pas s'y fier : c'est la seule
   * garde qui reste si un appelant interne l'invoque directement. Déclarer 500 « g » contre un
   * plafond en kg passerait sous le plafond et le consommerait à tort.
   */
  it("ignore une unité glissée dans le payload, et reprend celle du lot", async () => {
    await withdrawalService.recordWithdrawal(batchId, orgId, userId, {
      ...payload,
      unite: 'G',
    } as never);

    expect(vi.mocked(prisma.withdrawal.create).mock.calls[0][0].data).toMatchObject({ unite: 'KG' });
  });

  /**
   * Le geste est répétable : un magasin retire 40 le soir, 10 le lendemain. Le service ne doit donc
   * jamais court-circuiter une seconde déclaration — le seul frein est le plafond.
   */
  it('accepte une seconde déclaration pour la même paire (client, lot)', async () => {
    vi.mocked(prisma.withdrawal.aggregate).mockResolvedValue({
      _sum: { quantite: new Prisma.Decimal(25) },
    } as never);

    await withdrawalService.recordWithdrawal(batchId, orgId, userId, payload);

    expect(prisma.withdrawal.create).toHaveBeenCalledTimes(1);
  });

  /**
   * Le plafond ne compte QUE les expéditions livrées. Sommer aussi celles en route autoriserait à
   * déclarer retirée de la marchandise encore dans le camion.
   */
  it('ne compte que les expéditions livrées vers ce client', async () => {
    await withdrawalService.recordWithdrawal(batchId, orgId, userId, payload);

    const filtre = vi.mocked(prisma.liaison_Shipment.aggregate).mock.calls[0][0].where;
    expect(filtre).toMatchObject({
      id_lot: batchId,
      expedition: {
        organization_id: orgId,
        id_client: customerId,
        statut_livraison: 'LIVRE',
      },
    });
  });

  it('refuse un retrait qui dépasse ce qui a été livré à ce client', async () => {
    vi.mocked(prisma.withdrawal.aggregate).mockResolvedValue({
      _sum: { quantite: new Prisma.Decimal(35) },
    } as never);

    await expect(
      withdrawalService.recordWithdrawal(batchId, orgId, userId, payload)
    ).rejects.toMatchObject({ status: 409 });
    expect(prisma.withdrawal.create).not.toHaveBeenCalled();
  });

  /**
   * 40 - 30.1 - 9.9 vaut 0 en Decimal et -1.77e-15 en nombre JS : comparé en JS, le dernier retrait
   * légitime serait refusé.
   */
  it('compare les quantités en Decimal, jamais en nombre JS', async () => {
    vi.mocked(prisma.withdrawal.aggregate).mockResolvedValue({
      _sum: { quantite: new Prisma.Decimal('30.1') },
    } as never);

    await expect(
      withdrawalService.recordWithdrawal(batchId, orgId, userId, { ...payload, quantite: 9.9 })
    ).resolves.toBeDefined();
  });

  it('refuse quand rien n’a été livré à ce client', async () => {
    vi.mocked(prisma.liaison_Shipment.aggregate).mockResolvedValue({
      _sum: { quantite_expediee: null },
    } as never);

    await expect(
      withdrawalService.recordWithdrawal(batchId, orgId, userId, payload)
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rend 404 sur un lot d’une autre organisation', async () => {
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(null);

    await expect(
      withdrawalService.recordWithdrawal(batchId, orgId, userId, payload)
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rend 404 sur un client d’une autre organisation', async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(null);

    await expect(
      withdrawalService.recordWithdrawal(batchId, orgId, userId, payload)
    ).rejects.toMatchObject({ status: 404 });
  });

  it('trace le mouvement et scelle la décision dans la même transaction', async () => {
    await withdrawalService.recordWithdrawal(batchId, orgId, userId, payload);

    expect(vi.mocked(prisma.batch_Mouvement.create).mock.calls[0][0].data).toMatchObject({
      id_lot: batchId,
      type_action: MOVEMENT_TYPES.SHELF_WITHDRAWAL,
      id_user: userId,
    });
    // Deuxième argument = la transaction : hors d'elle, un rollback laisserait le retrait sans preuve.
    expect(vi.mocked(auditService.logAction).mock.calls[0][1]).toBe(prisma);
  });

  it('lit tout dans un instantané sérialisable, avec un budget de temps explicite', async () => {
    await withdrawalService.recordWithdrawal(batchId, orgId, userId, payload);

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15000,
      })
    );
  });
});
