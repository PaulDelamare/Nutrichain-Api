import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { recallService } from './recall.service';

// Les courriels partent hors transaction, après commit : les neutraliser ne change rien à ce qui
// est mesuré ici (les lots et les expéditions), et évite de dépendre d'un serveur SMTP.
vi.mock('../../../../shared/utils/mailer/notifyOrgAdmins', () => ({
  notifyOrgAdmins: vi.fn(),
}));
vi.mock('./recallNotifications', () => ({
  notifyRecallCustomers: vi.fn(),
}));

/**
 * La seule preuve qui vaut pour une simulation : jouer la simulation PUIS le rappel réel sur les
 * mêmes données, et comparer les deux ensembles. Une simulation qui annonce un autre chiffre que le
 * rappel est pire que pas de simulation — et deux requêtes SQL écrites séparément ne peuvent pas se
 * prouver équivalentes autrement que contre un vrai PostgreSQL.
 */
describe('simulateRecall vs triggerRecall — même impact (PostgreSQL réel)', () => {
  const orgId = `it-recall-sim-${Date.now()}`;
  const otherOrgId = `it-recall-sim-other-${Date.now()}`;
  let batchA: string, batchB: string, batchC: string, batchBlocked: string;
  let batchForeign: string;
  let shipmentRefC: string, shipmentRefBlocked: string;
  let userId: string;

  beforeAll(async () => {
    const product = await prisma.product.findFirst({ select: { id: true } });
    const unit = await prisma.unit.findFirst({ select: { code: true } });
    const user = await prisma.user.findFirst({ select: { id: true } });
    const equipment = await prisma.equipment.findFirst({ select: { id: true } });
    if (!product || !unit || !user || !equipment) {
      throw new Error('Fixtures manquantes : lancer `npx prisma db seed` avant ce test.');
    }
    userId = user.id;

    await prisma.organization.create({
      data: { id: orgId, name: 'IT Recall Sim', slug: orgId, createdAt: new Date(), metadata: '{}' },
    });
    await prisma.organization.create({
      data: {
        id: otherOrgId,
        name: 'IT Recall Sim Autre',
        slug: otherOrgId,
        createdAt: new Date(),
        metadata: '{}',
      },
    });

    const makeBatch = async (suffix: string, statut = 'EN_STOCK', organizationId = orgId) =>
      (
        await prisma.batch.create({
          data: {
            organization_id: organizationId,
            lot_number: `IT-SIM-${Date.now()}-${suffix}`,
            id_produit: product.id,
            unite_code: unit.code,
            quantite_actuelle: 10,
            quantite_base: 10,
            statut,
            created_by: user.id,
          },
          select: { id: true },
        })
      ).id;

    batchA = await makeBatch('A');
    batchB = await makeBatch('B');
    batchC = await makeBatch('C');
    // Descendant DÉJÀ bloqué : le rappel réel n'a aucun filtre de statut et le rebloque. Une
    // simulation qui l'écarterait sous-estimerait l'impact, exactement ce qu'elle doit interdire.
    batchBlocked = await makeBatch('BLOQUE', 'BLOQUE');
    // Descendant appartenant à une AUTRE organisation. La CTE récursive ne filtre pas le tenant :
    // seul le `WHERE` final le fait. Sans ce lot, retirer cette garde ne ferait rougir aucun test —
    // vérifié : le mutant survivait.
    batchForeign = await makeBatch('ETRANGER', 'EN_STOCK', otherOrgId);

    const link = async (parentId: string, childId: string) => {
      const transformation = await prisma.transformation.create({
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
          id_transformation: transformation.id,
          id_lot_parent: parentId,
          quantite_prelevee: 5,
          unite: unit.code,
          lot_parent_epuise: false,
        },
      });
    };

    await link(batchA, batchB);
    await link(batchB, batchC);
    await link(batchB, batchBlocked);
    await link(batchB, batchForeign);

    const makeShipment = async (suffix: string, batchId: string) => {
      const customer = await prisma.customer.create({
        data: {
          organization_id: orgId,
          nom_enseigne: `Enseigne ${suffix}`,
          contact_urgence: '+33600000000',
          email: `magasin-${suffix}@example.test`,
          adresse_livraison: `1 rue ${suffix}`,
        },
        select: { id: true },
      });
      const reference = `IT-SIM-SHIP-${suffix}-${Date.now()}`;
      const shipment = await prisma.shipment.create({
        data: {
          organization_id: orgId,
          id_client: customer.id,
          shipment_id: reference,
          date_envoi: new Date(),
          transporteur: 'Transports Test',
          statut_livraison: 'LIVRE',
          // `Shipment_livraison_coherente` exige les trois ensemble : statut, date et auteur.
          date_livraison: new Date(),
          delivered_by: user.id,
          created_by: user.id,
        },
        select: { id: true },
      });
      await prisma.liaison_Shipment.create({
        data: {
          id_expedition: shipment.id,
          id_lot: batchId,
          quantite_expediee: 5,
          unite: unit.code,
        },
      });
      return reference;
    };

    shipmentRefC = await makeShipment('C', batchC);
    shipmentRefBlocked = await makeShipment('BLOQUE', batchBlocked);
  });

  afterAll(async () => {
    for (const organizationId of [orgId, otherOrgId]) {
      await prisma.liaison_Shipment.deleteMany({ where: { lot: { organization_id: organizationId } } });
      await prisma.batch_Mouvement.deleteMany({ where: { lot: { organization_id: organizationId } } });
      await prisma.shipment.deleteMany({ where: { organization_id: organizationId } });
      await prisma.customer.deleteMany({ where: { organization_id: organizationId } });
      await prisma.transformationComposition.deleteMany({
        where: { lot_parent: { organization_id: organizationId } },
      });
      await prisma.transformation.deleteMany({
        where: { lot_enfant: { organization_id: organizationId } },
      });
      await prisma.batch.deleteMany({ where: { organization_id: organizationId } });
      await prisma.alert.deleteMany({ where: { organization_id: organizationId } });
      // Chaîne d'audit de l'organisation jetable, supprimée ENTIÈRE (jamais un maillon isolé, qui
      // romprait le chaînage). `Audit_Log.organization` est en `onDelete: Restrict` : sans ça,
      // l'organisation ne peut pas être supprimée.
      await prisma.audit_Log.deleteMany({ where: { organization_id: organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
  });

  it('annonce exactement les lots et les magasins que le rappel réel touchera', async () => {
    const auditBefore = await prisma.audit_Log.count({ where: { organization_id: orgId } });

    const simulation = await recallService.simulateRecall(batchA, orgId);

    // 1. La simulation n'a rien écrit : aucun statut n'a bougé, aucun maillon d'audit n'est né.
    const statusesAfterSimulation = await prisma.batch.findMany({
      where: { organization_id: orgId },
      select: { id: true, statut: true },
      orderBy: { id: 'asc' },
    });
    expect(statusesAfterSimulation.filter((b) => b.statut === 'ALERTE')).toEqual([]);
    expect(await prisma.audit_Log.count({ where: { organization_id: orgId } })).toBe(auditBefore);

    // 2. Le rappel réel, sur les mêmes données.
    const real = await recallService.triggerRecall(batchA, orgId, userId, 'Comparaison simulation');

    // 3. Les deux ensembles coïncident, lot par lot et magasin par magasin — comparés SANS les
    // retrier ici : trier des deux côtés masquerait un ordre non déterministe, qui fait varier la
    // liste tronquée d'un appel à l'autre.
    expect(simulation.impactedCount).toBe(real.blockedBatchesCount);
    expect(simulation.impactedBatchIds).toEqual(real.impactedBatchIds);
    expect(simulation.impactedBatchIds).toEqual([batchA, batchB, batchC, batchBlocked].sort());
    // Le descendant d'une autre organisation n'entre dans aucun des deux ensembles.
    expect(simulation.impactedBatchIds).not.toContain(batchForeign);

    const simulatedRefs = simulation.affectedShipments.map((s) => s.shipmentRef);
    expect(simulatedRefs).toEqual(real.affectedShipments.map((s) => s.shipmentRef));
    expect(simulatedRefs).toEqual([shipmentRefC, shipmentRefBlocked].sort());

    const simulatedByRef = new Map(simulation.affectedShipments.map((s) => [s.shipmentRef, s]));
    for (const shipment of real.affectedShipments) {
      expect(simulatedByRef.get(shipment.shipmentRef)?.batchIds).toEqual(shipment.batchIds);
      expect(simulatedByRef.get(shipment.shipmentRef)?.customerName).toBe(shipment.customerName);
    }
  });

  it('compte le lot seul quand il n a aucune descendance', async () => {
    const simulation = await recallService.simulateRecall(batchC, orgId);

    expect(simulation.impactedCount).toBe(1);
    expect(simulation.impactedBatchIds).toEqual([batchC]);
  });

  it("rend 404 quand le lot appartient à une autre organisation", async () => {
    await expect(recallService.simulateRecall(batchA, otherOrgId)).rejects.toMatchObject({
      status: 404,
    });
  });
});
