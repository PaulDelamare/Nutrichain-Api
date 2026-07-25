import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { genealogyService } from './genealogy.service';

/**
 * La CTE récursive (`WITH RECURSIVE`) n'existe que dans PostgreSQL : un mock de
 * `$queryRaw` ne peut prouver ni la récursion multi-niveaux, ni le cloisonnement par
 * organisation posé dans le `WHERE` final (#150).
 */
describe('genealogyService.getDownstream — CTE récursive (PostgreSQL réel)', () => {
  const orgId = `it-cte-${Date.now()}`;
  let batchA: string, batchB: string, batchC: string;

  beforeAll(async () => {
    const product = await prisma.product.findFirst({ select: { id: true } });
    const unit = await prisma.unit.findFirst({ select: { code: true } });
    const user = await prisma.user.findFirst({ select: { id: true } });
    const equipment = await prisma.equipment.findFirst({ select: { id: true } });
    if (!product || !unit || !user || !equipment) {
      throw new Error('Fixtures manquantes : lancer `npx prisma db seed` avant ce test.');
    }

    await prisma.organization.create({
      data: { id: orgId, name: 'IT CTE', slug: orgId, createdAt: new Date(), metadata: '{}' },
    });

    const makeBatch = (suffix: string) =>
      prisma.batch.create({
        data: {
          organization_id: orgId,
          lot_number: `IT-CTE-${Date.now()}-${suffix}`,
          id_produit: product.id,
          unite_code: unit.code,
          quantite_actuelle: 10,
          quantite_base: 10,
          created_by: user.id,
        },
        select: { id: true },
      });

    // A → (transformation 1) → B → (transformation 2) → C : deux niveaux de descendance.
    batchA = (await makeBatch('A')).id;
    batchB = (await makeBatch('B')).id;
    batchC = (await makeBatch('C')).id;

    const link = async (parentId: string, childId: string) => {
      const t = await prisma.transformation.create({
        data: {
          id_lot_enfant: childId,
          id_produit_fini: product.id,
          id_user: user.id,
          id_materiel: equipment.id,
          statut: 'TERMINE',
        },
      });
      await prisma.transformationComposition.create({
        data: {
          id_transformation: t.id,
          id_lot_parent: parentId,
          quantite_prelevee: 5,
          unite: unit.code,
          lot_parent_epuise: false,
        },
      });
    };

    await link(batchA, batchB);
    await link(batchB, batchC);
  });

  afterAll(async () => {
    await prisma.transformationComposition.deleteMany({
      where: { lot_parent: { organization_id: orgId } },
    });
    await prisma.transformation.deleteMany({ where: { lot_enfant: { organization_id: orgId } } });
    await prisma.batch.deleteMany({ where: { organization_id: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  it('remonte TOUTE la descendance sur plusieurs niveaux (A → B → C), pas seulement le niveau direct', async () => {
    const descendants = await genealogyService.getDownstream(batchA, orgId);
    const ids = descendants.map((b) => b.id).sort();

    expect(ids).toEqual([batchB, batchC].sort());
  });

  it('ne remonte rien pour un lot sans descendance (feuille de la généalogie)', async () => {
    const descendants = await genealogyService.getDownstream(batchC, orgId);

    expect(descendants).toEqual([]);
  });

  it("cloisonne par organisation : la même généalogie interrogée avec une AUTRE organisation ne renvoie rien", async () => {
    const otherOrgId = `it-cte-other-${Date.now()}`;
    await prisma.organization.create({
      data: {
        id: otherOrgId,
        name: 'IT CTE Other',
        slug: otherOrgId,
        createdAt: new Date(),
        metadata: '{}',
      },
    });

    try {
      const descendants = await genealogyService.getDownstream(batchA, otherOrgId);
      expect(descendants).toEqual([]);
    } finally {
      await prisma.organization.deleteMany({ where: { id: otherOrgId } });
    }
  });
});
