import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { auditService } from './audit.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    audit_Log: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe('AuditService (WORM - Write Once Read Many)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('doit générer un hash cohérent et inclure le hash précédent (Chaînage)', async () => {
    const mockTx = {
      $queryRaw: vi.fn().mockResolvedValue([{ signature_hash: 'PREV_HASH_123' }]),
      audit_Log: {
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data })),
      },
    };

    const auditData = {
      organizationId: 'org-1',
      userId: 'user-1',
      action: 'CREATE',
      entity: 'RECEIPT',
      entityId: 'rec-999',
      newValue: { status: 'OK' },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await auditService.logAction(auditData, mockTx as any);

    // Vérifier que le hash précédent a été récupéré
    expect(mockTx.$queryRaw).toHaveBeenCalled();

    // Vérifier que le nouveau log contient le prev_hash et une signature
    expect(result.prev_hash).toBe('PREV_HASH_123');
    expect(result.signature_hash).toBeDefined();
    expect(result.signature_hash).not.toBe('PREV_HASH_123');
  });

  it('doit fonctionner même s il s agit du tout premier log (prev_hash = "GENESIS")', async () => {
    const mockTx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      audit_Log: {
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data })),
      },
    };

    const result = await auditService.logAction(
      {
        organizationId: 'org-1',
        userId: 'admin',
        action: 'INIT',
        entity: 'SYSTEM',
        entityId: '0',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockTx as any
    );

    expect(result.prev_hash).toBe(
      '0000000000000000000000000000000000000000000000000000000000000000'
    );
  });

  it('doit produire un hash recalculable depuis les champs persistés (WORM A)', async () => {
    const createSpy = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));
    const mockTx = {
      $queryRaw: vi.fn().mockResolvedValue([{ signature_hash: 'PREV_HASH_XYZ' }]),
      audit_Log: { create: createSpy },
    };

    const result = await auditService.logAction(
      {
        organizationId: 'org-1',
        userId: 'user-1',
        action: 'UPDATE',
        entity: 'BATCH',
        entityId: 'batch-1',
        oldValue: { quantite: 100, statut: 'EN_STOCK' },
        newValue: { quantite: 80, statut: 'EN_STOCK' },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockTx as any
    );

    const persistedData = createSpy.mock.calls[0][0].data;

    expect(persistedData.horodatage).toBeInstanceOf(Date);

    const recomputed = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          organizationId: persistedData.organization_id,
          userId: persistedData.id_user || 'system',
          action: persistedData.action,
          entity: persistedData.entity,
          entityId: persistedData.entity_id,
          oldValue: persistedData.ancienne_valeur,
          newValue: persistedData.nouvelle_valeur,
          prevHash: persistedData.prev_hash,
          timestamp: persistedData.horodatage.toISOString(),
        })
      )
      .digest('hex');

    expect(result.signature_hash).toBe(recomputed);
  });

  it('doit détecter une altération du newValue par recalcul du hash', async () => {
    const createSpy = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));
    const mockTx = {
      $queryRaw: vi.fn().mockResolvedValue([{ signature_hash: 'PREV' }]),
      audit_Log: { create: createSpy },
    };

    const result = await auditService.logAction(
      {
        organizationId: 'org-1',
        userId: 'user-1',
        action: 'UPDATE',
        entity: 'BATCH',
        entityId: 'batch-1',
        newValue: { quantite: 80 },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockTx as any
    );

    const persistedData = createSpy.mock.calls[0][0].data;

    const tampered = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          organizationId: persistedData.organization_id,
          userId: persistedData.id_user || 'system',
          action: persistedData.action,
          entity: persistedData.entity,
          entityId: persistedData.entity_id,
          oldValue: persistedData.ancienne_valeur,
          newValue: { quantite: 999 },
          prevHash: persistedData.prev_hash,
          timestamp: persistedData.horodatage.toISOString(),
        })
      )
      .digest('hex');

    expect(tampered).not.toBe(result.signature_hash);
  });
});
