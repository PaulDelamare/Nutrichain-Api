import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recallService } from './recall.service';
import { genealogyService } from './genealogy.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { Batch } from '@prisma/client';
import { auditService } from '../../../../shared/utils/audit/audit.service';
import { logger } from '../../../../shared/utils/logger/logger';
import { notifyOrgAdmins } from '../../../../shared/utils/mailer/notifyOrgAdmins';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    $transaction: vi.fn(),
    batch: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    alert: {
      create: vi.fn(),
    },
    liaison_Shipment: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('./genealogy.service', () => ({
  genealogyService: {
    getDownstream: vi.fn(),
  },
}));

vi.mock('../../../../shared/utils/audit/audit.service', () => ({
  auditService: {
    logAction: vi.fn(),
  },
}));

vi.mock('../../../../shared/utils/logger/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../../shared/utils/mailer/notifyOrgAdmins', () => ({
  notifyOrgAdmins: vi.fn(),
}));

const orgId = 'org-123';
const userId = 'user-123';
const batchId = 'batch-root';

/**
 * Helpers de fabrication de mocks Liaison_Shipment + Shipment + Customer.
 */
const buildLiaison = (
  overrides: {
    id_lot?: string;
    id_expedition?: string;
    shipmentRef?: string;
    customerId?: string;
    customerName?: string;
    customerNull?: boolean;
    orgId?: string;
    pallet_id?: string;
  } = {}
) => ({
  id: `lia-${Math.random().toString(36).slice(2, 8)}`,
  id_expedition: overrides.id_expedition ?? 'ship-1',
  id_lot: overrides.id_lot ?? batchId,
  quantite_expediee: 10,
  unite: 'KG',
  pallet_id: overrides.pallet_id ?? null,
  expedition: {
    id: overrides.id_expedition ?? 'ship-1',
    organization_id: overrides.orgId ?? orgId,
    shipment_id: overrides.shipmentRef ?? 'SHIP-REF-001',
    date_envoi: new Date('2026-05-20T10:00:00Z'),
    transporteur: 'Transports Nutri',
    statut_livraison: 'LIVRE',
    id_client: overrides.customerId ?? 'cust-1',
    client: overrides.customerNull
      ? null
      : {
          id: overrides.customerId ?? 'cust-1',
          organization_id: overrides.orgId ?? orgId,
          nom_enseigne: overrides.customerName ?? 'Supermarché Central',
          contact_urgence: '+33612345678',
          adresse_livraison: '50 av Distribution, 75010 Paris',
        },
  },
});

describe('RecallService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Transaction qui forward au prisma mock
    vi.mocked(prisma.$transaction).mockImplementation((cb: (tx: unknown) => Promise<unknown>) =>
      cb(prisma)
    );
    // findFirst : lot source existant par défaut
    vi.mocked(prisma.batch.findFirst).mockResolvedValue({
      id: batchId,
      organization_id: orgId,
      statut: 'EN_STOCK',
    } as unknown as Batch);
    // Pas de descendants par défaut
    vi.mocked(genealogyService.getDownstream).mockResolvedValue([]);
    // Pas d'expédition par défaut
    vi.mocked(prisma.liaison_Shipment.findMany).mockResolvedValue([]);
    vi.mocked(auditService.logAction).mockResolvedValue({} as never);
  });

  // ===== Test existant (régression) =====
  it('doit bloquer le lot source et tous ses descendants', async () => {
    vi.mocked(genealogyService.getDownstream).mockResolvedValue([
      { id: 'batch-child-1', organization_id: orgId } as unknown as Batch,
      { id: 'batch-child-2', organization_id: orgId } as unknown as Batch,
    ]);

    const result = await recallService.triggerRecall(batchId, orgId, userId, 'Test Recall');

    expect(result.blockedBatchesCount).toBe(3);
    expect(prisma.batch.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['batch-root', 'batch-child-1', 'batch-child-2'] },
        organization_id: orgId,
      },
      data: {
        statut: 'ALERTE',
        version: { increment: 1 },
      },
    });
    expect(prisma.alert.create).toHaveBeenCalled();
  });

  it('notifie les admins de l org après un rappel réussi, avec le motif échappé (anti-XSS)', async () => {
    const result = await recallService.triggerRecall(batchId, orgId, userId, '<b>contaminé</b>');

    expect(notifyOrgAdmins).toHaveBeenCalledWith(
      orgId,
      expect.objectContaining({
        subject: expect.stringContaining(batchId),
        html: expect.stringContaining('&lt;b&gt;contaminé&lt;/b&gt;'),
      })
    );
    // La notification ne change pas le résultat métier
    expect(result.blockedBatchesCount).toBe(1);
  });

  it("n'émet aucune notification si le rappel échoue (lot source introuvable)", async () => {
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(null);

    await expect(
      recallService.triggerRecall('inconnu', orgId, userId, 'motif')
    ).rejects.toMatchObject({ status: 404 });
    expect(notifyOrgAdmins).not.toHaveBeenCalled();
  });

  // ===== Nouveaux tests pour affectedShipments =====
  describe('affectedShipments', () => {
    it('1. rappel sans aucune expédition → affectedShipments vide', async () => {
      vi.mocked(prisma.liaison_Shipment.findMany).mockResolvedValue([]);

      const result = await recallService.triggerRecall(batchId, orgId, userId, 'No shipments');

      expect(result.affectedShipments).toEqual([]);
      expect(result.blockedBatchesCount).toBe(1);
    });

    it('2. un lot impacté présent dans 2 expéditions différentes → 2 shipments distincts', async () => {
      vi.mocked(prisma.liaison_Shipment.findMany).mockResolvedValue([
        buildLiaison({
          id_expedition: 'ship-A',
          shipmentRef: 'SHIP-A',
          customerId: 'cust-A',
          customerName: 'Magasin A',
        }) as never,
        buildLiaison({
          id_expedition: 'ship-B',
          shipmentRef: 'SHIP-B',
          customerId: 'cust-B',
          customerName: 'Magasin B',
        }) as never,
      ]);

      const result = await recallService.triggerRecall(batchId, orgId, userId, 'Reason');

      expect(result.affectedShipments).toHaveLength(2);
      const names = result.affectedShipments.map((s) => s.customerName).sort();
      expect(names).toEqual(['Magasin A', 'Magasin B']);
    });

    it('3. une expédition contenant 2 lots impactés → 1 shipment, batchIds dédupliqué et trié', async () => {
      vi.mocked(genealogyService.getDownstream).mockResolvedValue([
        { id: 'batch-child', organization_id: orgId } as unknown as Batch,
      ]);
      vi.mocked(prisma.liaison_Shipment.findMany).mockResolvedValue([
        // 3 Liaisons : 2 pour le même shipment (lot source + descendant), + 1 doublon (pallet différent)
        buildLiaison({
          id_expedition: 'ship-1',
          id_lot: 'batch-root',
          pallet_id: 'PAL-1',
        }) as never,
        buildLiaison({
          id_expedition: 'ship-1',
          id_lot: 'batch-child',
          pallet_id: 'PAL-2',
        }) as never,
        buildLiaison({
          id_expedition: 'ship-1',
          id_lot: 'batch-root',
          pallet_id: 'PAL-3',
        }) as never, // doublon
      ]);

      const result = await recallService.triggerRecall(batchId, orgId, userId, 'Reason');

      expect(result.affectedShipments).toHaveLength(1);
      // Dédupliqué (PAL-3 ne crée pas un 3e batchId) et trié ASC
      expect(result.affectedShipments[0].batchIds).toEqual(['batch-child', 'batch-root']);
    });

    it('4. cross-tenant : le where contient bien expedition.organization_id, et tout résultat hors-org est filtré', async () => {
      // Defense-in-depth : même si Prisma renvoyait par bug un cross-org, on assert le where
      vi.mocked(prisma.liaison_Shipment.findMany).mockResolvedValue([]);

      await recallService.triggerRecall(batchId, orgId, userId, 'Reason');

      const findManyCall = vi.mocked(prisma.liaison_Shipment.findMany).mock.calls[0][0];
      // Defense-in-depth : les DEUX côtés de la jointure sont scoped à l'org courante
      expect(findManyCall).toMatchObject({
        where: {
          id_lot: { in: expect.arrayContaining(['batch-root']) },
          expedition: { organization_id: orgId },
          lot: { organization_id: orgId },
        },
      });
    });

    it('5. audit newValue contient affectedShipmentsCount + shipmentRefs (capés à 100)', async () => {
      const manyLiaisons = Array.from({ length: 150 }, (_, i) =>
        buildLiaison({
          id_expedition: `ship-${i}`,
          shipmentRef: `SHIP-REF-${i}`,
          customerId: `cust-${i}`,
          customerName: `Customer ${i}`,
        })
      );
      vi.mocked(prisma.liaison_Shipment.findMany).mockResolvedValue(manyLiaisons as never);

      await recallService.triggerRecall(batchId, orgId, userId, 'Massive recall');

      const auditCall = vi.mocked(auditService.logAction).mock.calls[0][0];
      expect(auditCall.newValue).toMatchObject({
        affectedShipmentsCount: 150,
      });
      const refs = (auditCall.newValue as { shipmentRefs: string[] }).shipmentRefs;
      expect(refs).toHaveLength(100); // capé à 100
      expect(refs[0]).toMatch(/^SHIP-REF-/);
    });

    it('6. customer null (référence cassée) → entrée skip, warn loggé SANS PII', async () => {
      vi.mocked(prisma.liaison_Shipment.findMany).mockResolvedValue([
        buildLiaison({
          id_expedition: 'ship-broken',
          shipmentRef: 'SHIP-BROKEN',
          customerNull: true,
        }) as never,
        buildLiaison({
          id_expedition: 'ship-ok',
          shipmentRef: 'SHIP-OK',
          customerName: 'OK Customer',
        }) as never,
      ]);

      const result = await recallService.triggerRecall(batchId, orgId, userId, 'Reason');

      // L'entrée client null est skippée
      expect(result.affectedShipments).toHaveLength(1);
      expect(result.affectedShipments[0].customerName).toBe('OK Customer');

      // logger.warn appelé avec le shipmentId, sans PII
      expect(logger.warn).toHaveBeenCalled();
      const warnArgs = vi.mocked(logger.warn).mock.calls.flat().join(' ');
      expect(warnArgs).toContain('ship-broken');
      // Aucune VRAIE PII ne doit fuiter dans le log (assertions sur les valeurs, pas les mots-clés)
      expect(warnArgs).not.toContain('+33612345678');
      expect(warnArgs).not.toContain('50 av Distribution');
    });
  });
});
