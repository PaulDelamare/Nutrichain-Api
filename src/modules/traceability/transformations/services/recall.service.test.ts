import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recallService, LIAISON_IN_CHUNK_SIZE } from './recall.service';
import { MAX_GENEALOGY_DEPTH } from './genealogy.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { Batch } from '@prisma/client';
import { auditService } from '../../../../shared/utils/audit/audit.service';
import { logger } from '../../../../shared/utils/logger/logger';
import { notifyOrgAdmins } from '../../../../shared/utils/mailer/notifyOrgAdmins';
import { notifyRecallCustomers } from './recallNotifications';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    batch: {
      findFirst: vi.fn(),
    },
    alert: {
      create: vi.fn(),
    },
    liaison_Shipment: {
      findMany: vi.fn(),
    },
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

vi.mock('./recallNotifications', () => ({
  notifyRecallCustomers: vi.fn(),
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
    customerEmail?: string | null;
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
          email:
            overrides.customerEmail === undefined ? 'client@example.com' : overrides.customerEmail,
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
    // Blocage set-based par défaut : seul le lot source impacté, pas de saturation
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { impacted_ids: [batchId], max_depth: 0 },
    ] as never);
    // Pas d'expédition par défaut
    vi.mocked(prisma.liaison_Shipment.findMany).mockResolvedValue([]);
    vi.mocked(auditService.logAction).mockResolvedValue({} as never);
  });

  // ===== Test existant (régression) =====
  it('doit bloquer le lot source et toute sa descendance (RETURNING exhaustif)', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { impacted_ids: ['batch-root', 'batch-child-1', 'batch-child-2'], max_depth: 1 },
    ] as never);

    const result = await recallService.triggerRecall(batchId, orgId, userId, 'Test Recall');

    expect(result.blockedBatchesCount).toBe(3);
    expect(result.impactedBatchIds).toEqual(['batch-root', 'batch-child-1', 'batch-child-2']);
    expect(result.depthSaturated).toBe(false);
    // Le blocage passe par un UPDATE set-based (plus de updateMany à liste d'ids matérialisée)
    expect(prisma.$queryRaw).toHaveBeenCalled();
    // Hors saturation : une seule alerte (PRODUCT_RECALL), pas d'alerte de saturation
    expect(prisma.alert.create).toHaveBeenCalledTimes(1);
  });

  it('saturation de la garde anti-cycle : alerte CRITIQUE + flag, jamais de throw', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { impacted_ids: ['batch-root', 'b1', 'b2'], max_depth: MAX_GENEALOGY_DEPTH },
    ] as never);

    const result = await recallService.triggerRecall(batchId, orgId, userId, 'Cycle');

    expect(result.blockedBatchesCount).toBe(3);
    expect(result.depthSaturated).toBe(true);
    const alertTypes = vi
      .mocked(prisma.alert.create)
      .mock.calls.map((c) => (c[0] as { data: { type: string } }).data.type);
    expect(alertTypes).toContain('PRODUCT_RECALL');
    expect(alertTypes).toContain('RECALL_DEPTH_SATURATION');
    expect(logger.error).toHaveBeenCalled();
  });

  it('rappel massif : le join Liaison est découpé sous le plafond 65535 params', async () => {
    const manyIds = Array.from({ length: LIAISON_IN_CHUNK_SIZE + 1 }, (_, i) => `lot-${i}`);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { impacted_ids: manyIds, max_depth: 1 },
    ] as never);

    const result = await recallService.triggerRecall(batchId, orgId, userId, 'Massive');

    expect(result.blockedBatchesCount).toBe(manyIds.length);
    // 20001 ids → 2 appels findMany (20000 + 1), aucun appel ne dépasse le plafond
    expect(prisma.liaison_Shipment.findMany).toHaveBeenCalledTimes(2);
    const firstChunk = vi.mocked(prisma.liaison_Shipment.findMany).mock.calls[0][0] as {
      where: { id_lot: { in: string[] } };
    };
    expect(firstChunk.where.id_lot.in).toHaveLength(LIAISON_IN_CHUNK_SIZE);
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

  it('notifie les clients externes des expéditions impactées (avec leur email propagé)', async () => {
    vi.mocked(prisma.liaison_Shipment.findMany).mockResolvedValue([
      buildLiaison({
        shipmentRef: 'SHIP-A',
        customerName: 'Magasin A',
        customerEmail: 'a@x.com',
      }) as never,
    ]);

    const result = await recallService.triggerRecall(batchId, orgId, userId, 'Listeria');

    expect(notifyRecallCustomers).toHaveBeenCalledWith(
      result.affectedShipments,
      batchId,
      'Listeria'
    );
    expect(result.affectedShipments[0].customerEmail).toBe('a@x.com');
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
      vi.mocked(prisma.$queryRaw).mockResolvedValue([
        { impacted_ids: ['batch-root', 'batch-child'], max_depth: 1 },
      ] as never);
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
