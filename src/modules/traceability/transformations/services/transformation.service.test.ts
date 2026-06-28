import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transformationService } from './transformation.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../../shared/utils/audit/audit.service';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    $transaction: vi.fn(),
    batch: {
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    transformation: {
      create: vi.fn(),
    },
    transformationComposition: {
      create: vi.fn(),
    },
    batch_Mouvement: {
      create: vi.fn(),
    },
    ePCIS_Event: {
      create: vi.fn(),
    },
  },
}));

vi.mock('../../../../shared/utils/audit/audit.service', () => ({
  auditService: {
    logAction: vi.fn().mockResolvedValue({}),
  },
}));

describe('TransformationService', () => {
  const activeOrgId = 'org-123';
  const userId = 'user-abc';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const buildHappyMockTx = (overrides: { batch?: Record<string, unknown> } = {}) => ({
    batch: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'lot-p1',
        organization_id: activeOrgId,
        quantite_actuelle: { toNumber: () => 100 },
        unite_code: 'KG',
        statut: 'EN_STOCK',
        version: 1,
      }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'lot-p1',
        organization_id: activeOrgId,
        version: 1,
        quantite_actuelle: {
          toNumber: () => 100,
          minus: (n: number) => ({ toNumber: () => 100 - n }),
        },
        statut: 'EN_STOCK',
      }),
      create: vi.fn().mockResolvedValue({ id: 'lot-enfant' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      ...overrides.batch,
    },
    transformation: { create: vi.fn().mockResolvedValue({ id: 'trans-1' }) },
    transformationComposition: { create: vi.fn() },
    batch_Mouvement: { create: vi.fn() },
    ePCIS_Event: { create: vi.fn() },
  });

  it('doit échouer si un lot parent est introuvable ou appartient à une autre organisation', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)
    );
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(null);

    const data = {
      organization_id: activeOrgId,
      id_produit_fini: 'prod-fini',
      id_materiel: 'mat-1',
      quantite_produite: 100,
      unite_code: 'KG',
      created_by: userId,
      inputs: [
        { id_lot_parent: 'lot-p1', quantite_prelevee: 50, unite: 'KG', lot_parent_epuise: true },
      ],
    };

    await expect(transformationService.createTransformation(data)).rejects.toThrow(APIError);
  });

  it('doit échouer si un lot parent est périmé', async () => {
    const mockTx = {
      batch: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'lot-p1',
          organization_id: activeOrgId,
          quantite_actuelle: { toNumber: () => 100 },
          unite_code: 'KG',
          statut: 'EN_STOCK',
          date_peremption: new Date('2020-01-01'), // Déjà périmé
          version: 1,
        }),
      },
    };
    vi.mocked(prisma.$transaction).mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback(mockTx)
    );

    const data = {
      organization_id: activeOrgId,
      id_produit_fini: 'prod-fini',
      id_materiel: 'mat-1',
      quantite_produite: 50,
      unite_code: 'KG',
      created_by: userId,
      inputs: [
        { id_lot_parent: 'lot-p1', quantite_prelevee: 10, unite: 'KG', lot_parent_epuise: false },
      ],
    };

    try {
      await transformationService.createTransformation(data);
      expect.fail('Should have thrown');
    } catch (error: unknown) {
      const err = error as APIError;
      expect(err.status).toBe(400);
      expect(err.body.error[0].message).toContain('périmé');
    }
  });

  it('doit échouer si un lot parent est en ALERTE', async () => {
    const mockTx = {
      batch: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'lot-p1',
          organization_id: activeOrgId,
          quantite_actuelle: { toNumber: () => 100 },
          unite_code: 'KG',
          statut: 'ALERTE',
          version: 1,
        }),
      },
    };
    vi.mocked(prisma.$transaction).mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback(mockTx)
    );

    const data = {
      organization_id: activeOrgId,
      id_produit_fini: 'prod-fini',
      id_materiel: 'mat-1',
      quantite_produite: 50,
      unite_code: 'KG',
      created_by: userId,
      inputs: [
        { id_lot_parent: 'lot-p1', quantite_prelevee: 10, unite: 'KG', lot_parent_epuise: false },
      ],
    };

    try {
      await transformationService.createTransformation(data);
      expect.fail('Should have thrown');
    } catch (error: unknown) {
      const err = error as APIError;
      expect(err.status).toBe(400);
      expect(err.body.error[0].message).toContain('ALERTE');
    }
  });

  it('doit échouer si un lot parent est en quarantaine (BLOQUE)', async () => {
    const mockTx = {
      batch: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'lot-p1',
          organization_id: activeOrgId,
          quantite_actuelle: { toNumber: () => 100 },
          unite_code: 'KG',
          statut: 'BLOQUE',
          version: 1,
        }),
      },
    };
    vi.mocked(prisma.$transaction).mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback(mockTx)
    );

    const data = {
      organization_id: activeOrgId,
      id_produit_fini: 'prod-fini',
      id_materiel: 'mat-1',
      quantite_produite: 50,
      unite_code: 'KG',
      created_by: userId,
      inputs: [
        { id_lot_parent: 'lot-p1', quantite_prelevee: 10, unite: 'KG', lot_parent_epuise: false },
      ],
    };

    try {
      await transformationService.createTransformation(data);
      expect.fail('Should have thrown');
    } catch (error: unknown) {
      const err = error as APIError;
      expect(err.status).toBe(400);
      expect(err.body.error[0].message).toContain('BLOQUE');
    }
  });

  it('doit créer une transformation et un lot enfant avec succès', async () => {
    const mockTx = buildHappyMockTx();

    vi.mocked(prisma.$transaction).mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback(mockTx)
    );

    const data = {
      organization_id: activeOrgId,
      id_produit_fini: 'prod-fini',
      id_materiel: 'mat-1',
      quantite_produite: 50,
      unite_code: 'KG',
      created_by: userId,
      inputs: [
        { id_lot_parent: 'lot-p1', quantite_prelevee: 30, unite: 'KG', lot_parent_epuise: false },
      ],
    };

    const result = await transformationService.createTransformation(data);

    expect(result).toBeDefined();
    expect(mockTx.batch.create).toHaveBeenCalled();
    expect(mockTx.transformation.create).toHaveBeenCalled();
    expect(mockTx.batch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'lot-p1',
          organization_id: activeOrgId,
          version: 1,
        },
      })
    );
    expect(mockTx.ePCIS_Event.create).toHaveBeenCalled();
  });

  it("doit enregistrer dans l'audit les valeurs réelles du lot consommé (Bug 2)", async () => {
    const mockTx = buildHappyMockTx();

    vi.mocked(prisma.$transaction).mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback(mockTx)
    );

    const data = {
      organization_id: activeOrgId,
      id_produit_fini: 'prod-fini',
      id_materiel: 'mat-1',
      quantite_produite: 50,
      unite_code: 'KG',
      created_by: userId,
      inputs: [
        { id_lot_parent: 'lot-p1', quantite_prelevee: 30, unite: 'KG', lot_parent_epuise: false },
      ],
    };

    await transformationService.createTransformation(data);

    expect(vi.mocked(auditService.logAction)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TRANSFORM_CONSUME',
        newValue: { quantite: 70, statut: 'EN_STOCK' },
      }),
      expect.anything()
    );
  });

  it('doit lever APIError 409 si la version du lot parent a changé (optimistic locking)', async () => {
    const mockTx = buildHappyMockTx({
      batch: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    });

    vi.mocked(prisma.$transaction).mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback(mockTx)
    );

    const data = {
      organization_id: activeOrgId,
      id_produit_fini: 'prod-fini',
      id_materiel: 'mat-1',
      quantite_produite: 50,
      unite_code: 'KG',
      created_by: userId,
      inputs: [
        { id_lot_parent: 'lot-p1', quantite_prelevee: 30, unite: 'KG', lot_parent_epuise: false },
      ],
    };

    try {
      await transformationService.createTransformation(data);
      expect.fail('Should have thrown APIError 409');
    } catch (error: unknown) {
      const err = error as APIError;
      expect(err.status).toBe(409);
      expect(err.body.error[0].message).toContain('Race Condition détectée');
    }
  });

  it("doit marquer le lot comme EPUISE dans l'audit si lot_parent_epuise (Bug 2)", async () => {
    const mockTx = buildHappyMockTx();

    vi.mocked(prisma.$transaction).mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback(mockTx)
    );

    const data = {
      organization_id: activeOrgId,
      id_produit_fini: 'prod-fini',
      id_materiel: 'mat-1',
      quantite_produite: 50,
      unite_code: 'KG',
      created_by: userId,
      inputs: [
        { id_lot_parent: 'lot-p1', quantite_prelevee: 100, unite: 'KG', lot_parent_epuise: true },
      ],
    };

    await transformationService.createTransformation(data);

    expect(vi.mocked(auditService.logAction)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TRANSFORM_CONSUME',
        newValue: { quantite: 0, statut: 'EPUISE' },
      }),
      expect.anything()
    );
  });
});
