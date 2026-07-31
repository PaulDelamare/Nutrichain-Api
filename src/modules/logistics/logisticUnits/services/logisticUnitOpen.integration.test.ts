import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { logisticUnitService } from './logisticUnit.service';

/**
 * Ouvrir une palette est IRRÉVERSIBLE : deux ouvertures concurrentes ne doivent en sceller qu'une.
 *
 * Un mock Prisma rend le `count` qu'on lui demande — il ne peut donc jamais prouver ce qui se passe
 * réellement quand deux transactions Serializable visent la même ligne. Ce test-ci le mesure, au
 * lieu de le tenir par raisonnement : la garde applicative, le `updateMany` conditionné sur
 * `opened_at: null` et le rejeu de `retryableTransaction` sont exercés ensemble, contre PostgreSQL.
 */
describe('ouverture de palette sous concurrence (PostgreSQL réel)', () => {
  let orgId: string;
  let userId: string;
  let unitCode: string;
  let productId: string;
  const created: { batches: string[]; units: string[] } = { batches: [], units: [] };

  beforeAll(async () => {
    // On part du PRODUIT : `organization.findFirst` rend une organisation arbitraire, qui n'a pas
    // forcément de catalogue. Le produit, lui, porte l'organisation où le scénario est jouable.
    const product = await prisma.product.findFirst({
      where: { is_active: true },
      select: { id: true, organization_id: true },
    });
    const unit = await prisma.unit.findFirst({ select: { code: true } });
    const member = await prisma.member.findFirst({
      where: { organizationId: product?.organization_id },
      select: { userId: true },
    });
    if (!product || !unit || !member) {
      throw new Error('Fixtures manquantes : lancer `npx prisma db seed` avant ce test.');
    }
    orgId = product.organization_id;
    productId = product.id;
    unitCode = unit.code;
    userId = member.userId;
  });

  afterAll(async () => {
    // On ne touche PAS à Audit_Log : la chaîne est chaînée par hash, en retirer un maillon la
    // romprait pour toute l'organisation.
    for (const id of created.units) {
      await prisma.logistic_Unit_Content.deleteMany({ where: { id_unite_logistique: id } });
      await prisma.ePCIS_Event.deleteMany({ where: { related_id: id } });
      await prisma.logistic_Unit.deleteMany({ where: { id } });
    }
    await prisma.batch.deleteMany({ where: { id: { in: created.batches } } });
  });

  async function palettiser(): Promise<{ unitId: string; batchId: string }> {
    const stamp = `${Date.now()}${Math.trunc(process.hrtime()[1] / 1000)}`;
    const batch = await prisma.batch.create({
      data: {
        organization_id: orgId,
        lot_number: `IT-OPEN-${stamp}`,
        id_produit: productId,
        unite_code: unitCode,
        quantite_actuelle: 100,
        quantite_base: 100,
        statut: 'EN_STOCK',
        created_by: userId,
      },
      select: { id: true },
    });
    created.batches.push(batch.id);

    const unit = await logisticUnitService.createLogisticUnit({
      organizationId: orgId,
      userId,
      items: [{ id_lot: batch.id, quantite: 10 }],
    });
    created.units.push(unit.id);
    return { unitId: unit.id, batchId: batch.id };
  }

  // Ce test prouve qu'aucune des deux n'explose, et que le détachement n'est pas compté deux fois.
  // Il ne prouve PAS à lui seul l'unicité du geste : vérifié par mutation, il survit au retrait des
  // gardes de concurrence. C'est le test suivant, sur le maillon d'audit, qui porte cette preuve.
  it('deux ouvertures simultanées ne lèvent aucune erreur', async () => {
    const { unitId } = await palettiser();

    const [a, b] = await Promise.allSettled([
      logisticUnitService.openLogisticUnit(unitId, orgId, userId),
      logisticUnitService.openLogisticUnit(unitId, orgId, userId),
    ]);

    // Aucune des deux ne doit exploser : soit elle ouvre, soit elle constate que c'est déjà fait.
    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');

    const detachements = [a, b]
      .filter((r): r is PromiseFulfilledResult<{ lots_detaches: number }> => r.status === 'fulfilled')
      .map((r) => r.value.lots_detaches);

    // Exactement UNE ouverture a détaché le lot. Si les deux détachaient, la palette aurait été
    // vidée deux fois et deux maillons d'audit auraient scellé le même geste.
    expect(detachements.filter((n) => n === 1)).toHaveLength(1);
    expect(detachements.filter((n) => n === 0)).toHaveLength(1);
  });

  it('un seul maillon d’audit est scellé, et un seul événement EPCIS émis', async () => {
    const { unitId } = await palettiser();

    await Promise.allSettled([
      logisticUnitService.openLogisticUnit(unitId, orgId, userId),
      logisticUnitService.openLogisticUnit(unitId, orgId, userId),
      logisticUnitService.openLogisticUnit(unitId, orgId, userId),
    ]);

    const maillons = await prisma.audit_Log.count({
      where: { organization_id: orgId, action: 'OPEN_LOGISTIC_UNIT', entity_id: unitId },
    });
    expect(maillons).toBe(1);

    const desagregations = await prisma.ePCIS_Event.count({
      where: { related_id: unitId, event_type: 'AggregationEvent' },
    });
    // Un ADD à la palettisation, un seul DELETE à l'ouverture.
    expect(desagregations).toBe(2);

    const restant = await prisma.logistic_Unit_Content.count({
      where: { id_unite_logistique: unitId },
    });
    expect(restant).toBe(0);
  });
});
