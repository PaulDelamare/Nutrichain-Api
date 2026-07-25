import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transformationService } from './transformation.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../../shared/utils/audit/audit.service';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    $transaction: vi.fn(),
    product: {
      findFirst: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
    },
    equipment: {
      findFirst: vi.fn(),
    },
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
    // Cas nominal : la cuve appartient bien à l'organisation. Les tests qui éprouvent le
    // cloisonnement du matériel la remettent explicitement à `null`.

    vi.mocked(prisma.equipment.findFirst).mockResolvedValue({ id: 'mat-1' } as never);
  });

  const buildHappyMockTx = (overrides: { batch?: Record<string, unknown> } = {}) => ({
    product: {
      findFirst: vi.fn().mockResolvedValue({ code_gtin: '3456789012345', is_active: true }),
    },
    organization: {
      findUnique: vi.fn().mockResolvedValue({ gs1_company_prefix: '3456789' }),
    },
    // La cuve appartient bien à l'organisation.
    equipment: { findFirst: vi.fn().mockResolvedValue({ id: 'mat-1' }) },
    batch: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'lot-p1',
        organization_id: activeOrgId,
        lot_number: '260704-PAR001',
        produit: { code_gtin: '3456789012345' },
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
      create: vi.fn().mockResolvedValue({ id: 'lot-enfant', lot_number: '260704-ENF001' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      ...overrides.batch,
    },
    transformation: { create: vi.fn().mockResolvedValue({ id: 'trans-1' }) },
    transformationComposition: { create: vi.fn() },
    batch_Mouvement: { create: vi.fn() },
    ePCIS_Event: { create: vi.fn() },
  });

  it('doit échouer si le matériel appartient à une autre organisation', async () => {
    // Le produit fini et les lots parents étaient cloisonnés ; la CUVE, non — elle partait telle
    // quelle dans `id_materiel_actuel` et dans le readPoint EPCIS.
    //
    // Ce n'est pas qu'une référence sale : la quarantaine automatique sur excursion de température
    // croise `organization_id` ET `id_materiel_actuel`. Un lot fini rattaché au frigo d'une AUTRE
    // entreprise n'est donc bloqué par personne — ni par la sienne (mauvais matériel), ni par
    // l'autre (mauvaise organisation). Il échappe définitivement au rappel.
    vi.mocked(prisma.$transaction).mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)
    );

    vi.mocked(prisma.product.findFirst).mockResolvedValue({
      code_gtin: '3456789012345',
      is_active: true,
    } as never);
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      gs1_company_prefix: '3456789',
    } as never);
    // La cuve n'existe pas DANS CETTE ORGANISATION.
    vi.mocked(prisma.equipment.findFirst).mockResolvedValue(null);

    const data = {
      organization_id: activeOrgId,
      id_produit_fini: 'prod-fini',
      id_materiel: 'cuve-d-une-autre-entreprise',
      quantite_produite: 100,
      unite_code: 'KG',
      created_by: userId,
      inputs: [
        { id_lot_parent: 'lot-p1', quantite_prelevee: 50, unite: 'KG' },
      ],
    };

    await expect(transformationService.createTransformation(data)).rejects.toMatchObject({
      status: 404,
      body: { error: [{ field: 'id_materiel' }] },
    });

    // Et surtout : aucun lot n'a été créé sur ce matériel.
    expect(prisma.batch.create).not.toHaveBeenCalled();
  });

  it('doit échouer si un lot parent est introuvable ou appartient à une autre organisation', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)
    );

    vi.mocked(prisma.product.findFirst).mockResolvedValue({
      code_gtin: '3456789012345',
      is_active: true,
    } as never);

    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      gs1_company_prefix: '3456789',
    } as never);
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(null);

    const data = {
      organization_id: activeOrgId,
      id_produit_fini: 'prod-fini',
      id_materiel: 'mat-1',
      quantite_produite: 100,
      unite_code: 'KG',
      created_by: userId,
      inputs: [
        { id_lot_parent: 'lot-p1', quantite_prelevee: 50, unite: 'KG' },
      ],
    };

    await expect(transformationService.createTransformation(data)).rejects.toThrow(APIError);
  });

  it('doit échouer si un lot parent est périmé', async () => {
    const mockTx = {
      product: {
        findFirst: vi.fn().mockResolvedValue({ code_gtin: '3456789012345', is_active: true }),
      },
      organization: { findUnique: vi.fn().mockResolvedValue({ gs1_company_prefix: '3456789' }) },
      equipment: { findFirst: vi.fn().mockResolvedValue({ id: 'mat-1' }) },
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
        { id_lot_parent: 'lot-p1', quantite_prelevee: 10, unite: 'KG' },
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
      product: {
        findFirst: vi.fn().mockResolvedValue({ code_gtin: '3456789012345', is_active: true }),
      },
      organization: { findUnique: vi.fn().mockResolvedValue({ gs1_company_prefix: '3456789' }) },
      equipment: { findFirst: vi.fn().mockResolvedValue({ id: 'mat-1' }) },
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
        { id_lot_parent: 'lot-p1', quantite_prelevee: 10, unite: 'KG' },
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
      product: {
        findFirst: vi.fn().mockResolvedValue({ code_gtin: '3456789012345', is_active: true }),
      },
      organization: { findUnique: vi.fn().mockResolvedValue({ gs1_company_prefix: '3456789' }) },
      equipment: { findFirst: vi.fn().mockResolvedValue({ id: 'mat-1' }) },
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
        { id_lot_parent: 'lot-p1', quantite_prelevee: 10, unite: 'KG' },
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
        { id_lot_parent: 'lot-p1', quantite_prelevee: 30, unite: 'KG' },
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

  it('doit émettre un TransformationEvent EPCIS avec URN LGTIN (entrées et sortie)', async () => {
    const mockTx = buildHappyMockTx();

    vi.mocked(prisma.$transaction).mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback(mockTx)
    );

    await transformationService.createTransformation({
      organization_id: activeOrgId,
      id_produit_fini: 'prod-fini',
      id_materiel: 'mat-1',
      quantite_produite: 50,
      unite_code: 'KG',
      created_by: userId,
      inputs: [
        { id_lot_parent: 'lot-p1', quantite_prelevee: 30, unite: 'KG' },
      ],
    });

    expect(mockTx.ePCIS_Event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organization_id: activeOrgId,
        event_type: 'TransformationEvent',
        related_entity: 'Transformation',
        related_id: 'trans-1',
        payload: expect.objectContaining({
          inputQuantityList: [
            {
              epcClass: 'urn:epc:class:lgtin:3456789.001234.260704-PAR001',
              quantity: 30,
              uom: 'KG',
            },
          ],
          outputQuantityList: [
            {
              epcClass: 'urn:epc:class:lgtin:3456789.001234.260704-ENF001',
              quantity: 50,
              uom: 'KG',
            },
          ],
          bizStep: 'urn:epcglobal:cbv:bizstep:transforming',
        }),
      }),
    });
  });

  it("doit échouer (404) si le produit fini n'appartient pas à l'organisation", async () => {
    const mockTx = buildHappyMockTx();
    mockTx.product.findFirst.mockResolvedValue(null);

    vi.mocked(prisma.$transaction).mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback(mockTx)
    );

    await expect(
      transformationService.createTransformation({
        organization_id: activeOrgId,
        id_produit_fini: 'prod-autre-org',
        id_materiel: 'mat-1',
        quantite_produite: 50,
        unite_code: 'KG',
        created_by: userId,
        inputs: [
          { id_lot_parent: 'lot-p1', quantite_prelevee: 30, unite: 'KG' },
        ],
      })
    ).rejects.toMatchObject({
      status: 404,
      body: { error: [{ field: 'id_produit_fini' }] },
    });
    // La garde tombe avant toute écriture.
    expect(mockTx.batch.create).not.toHaveBeenCalled();
  });

  it("doit enregistrer dans l'audit les valeurs réelles du lot consommé", async () => {
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
        { id_lot_parent: 'lot-p1', quantite_prelevee: 30, unite: 'KG' },
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
        { id_lot_parent: 'lot-p1', quantite_prelevee: 30, unite: 'KG' },
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

  /**
   * `lot_parent_epuise` n'existe plus côté client (#123) : un opérateur qui prélève la
   * totalité du stock voit le lot marqué EPUISE même sans jamais avoir déclaré ce booléen —
   * c'est dérivé de la quantité réellement relue en base, pas d'une case cochée.
   */
  it("doit marquer le lot comme EPUISE dans l'audit quand le prélèvement épuise le stock réel", async () => {
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
        { id_lot_parent: 'lot-p1', quantite_prelevee: 100, unite: 'KG' },
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
