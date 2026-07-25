import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../../shared/configs/prismaClient.config';

/**
 * Le verrou optimiste de déduction de stock (`updateMany` conditionné sur `version`) est le motif
 * répété dans `transformation.service.ts`, `shipment.service.ts`, `batch.service.ts` : un mock
 * Prisma rend `count: 1` quel que soit le `where`, il ne peut donc jamais prouver qu'un
 * `updateMany` perdant renvoie réellement `count: 0` contre PostgreSQL (#150).
 */
describe('verrou optimiste sur Batch.version (PostgreSQL réel)', () => {
  let orgId: string;
  let productId: string;
  let unitCode: string;
  let userId: string;
  let batchId: string;

  beforeAll(async () => {
    const org = await prisma.organization.findFirst({ select: { id: true } });
    const product = await prisma.product.findFirst({
      where: { organization_id: org?.id },
      select: { id: true },
    });
    const unit = await prisma.unit.findFirst({ select: { code: true } });
    const user = await prisma.user.findFirst({ select: { id: true } });
    if (!org || !product || !unit || !user) {
      throw new Error('Fixtures manquantes : lancer `npx prisma db seed` avant ce test.');
    }
    orgId = org.id;
    productId = product.id;
    unitCode = unit.code;
    userId = user.id;

    const batch = await prisma.batch.create({
      data: {
        organization_id: orgId,
        lot_number: `IT-VERLOCK-${Date.now()}`,
        id_produit: productId,
        unite_code: unitCode,
        quantite_actuelle: 100,
        quantite_base: 100,
        created_by: userId,
      },
      select: { id: true },
    });
    batchId = batch.id;
  });

  afterAll(async () => {
    await prisma.batch.deleteMany({ where: { id: batchId } });
  });

  it("sur deux updateMany concurrents conditionnés sur la MÊME version lue, exactement l'un des deux gagne (count 1), l'autre est refusé (count 0)", async () => {
    const before = await prisma.batch.findUniqueOrThrow({
      where: { id: batchId },
      select: { version: true },
    });

    // Les deux lectures partagent la même version, comme deux requêtes concurrentes qui liraient le
    // lot avant que l'autre n'ait écrit — le scénario exact que le verrou optimiste doit départager.
    const [resultA, resultB] = await Promise.all([
      prisma.batch.updateMany({
        where: { id: batchId, version: before.version },
        data: { quantite_actuelle: { decrement: 10 }, version: { increment: 1 } },
      }),
      prisma.batch.updateMany({
        where: { id: batchId, version: before.version },
        data: { quantite_actuelle: { decrement: 20 }, version: { increment: 1 } },
      }),
    ]);

    const counts = [resultA.count, resultB.count].sort();
    expect(counts).toEqual([0, 1]);

    // Version incrémentée une seule fois, et seule LA déduction du gagnant est appliquée — la
    // preuve qu'aucune écriture perdante n'a partiellement pris effet.
    const after = await prisma.batch.findUniqueOrThrow({
      where: { id: batchId },
      select: { version: true, quantite_actuelle: true },
    });
    expect(after.version).toBe(before.version + 1);
    const applied = 100 - after.quantite_actuelle.toNumber();
    expect([10, 20]).toContain(applied);
  });
});
