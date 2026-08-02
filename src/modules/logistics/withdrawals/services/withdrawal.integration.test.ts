import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { withdrawalService } from './withdrawal.service';

/**
 * Le plafond du retrait est un invariant de CONCURRENCE : deux déclarations simultanées sur la même
 * paire (client, lot) doivent voir le même cumul. Un test unitaire mocke l'agrégat et ne prouve donc
 * rien ; seul un vrai PostgreSQL exerce l'isolation Serializable et le rejeu.
 *
 * Il vérifie aussi que le plafond ne compte QUE les expéditions livrées — un mock l'aurait affirmé
 * sans le prouver, puisque c'est le `where` lui-même qui est en cause.
 */
describe('withdrawalService — plafond et concurrence (PostgreSQL réel)', () => {
  const orgId = `it-retrait-${Date.now()}`;
  let batchId: string;
  let customerId: string;
  let autreClientId: string;
  let userId: string;

  beforeAll(async () => {
    const product = await prisma.product.findFirst({ select: { id: true } });
    const unit = await prisma.unit.findFirst({ select: { code: true } });
    const user = await prisma.user.findFirst({ select: { id: true } });
    if (!product || !unit || !user) {
      throw new Error('Fixtures manquantes : lancer `npx prisma db seed` avant ce test.');
    }
    userId = user.id;

    await prisma.organization.create({
      data: { id: orgId, name: 'IT Retrait', slug: orgId, createdAt: new Date(), metadata: '{}' },
    });

    batchId = (
      await prisma.batch.create({
        data: {
          organization_id: orgId,
          lot_number: `IT-RETRAIT-${Date.now()}`,
          id_produit: product.id,
          unite_code: unit.code,
          quantite_actuelle: 0,
          quantite_base: 100,
          created_by: userId,
        },
        select: { id: true },
      })
    ).id;

    const creerClient = async (nom: string) =>
      (
        await prisma.customer.create({
          data: {
            organization_id: orgId,
            nom_enseigne: nom,
            adresse_livraison: '1 rue du Rayon',
          },
          select: { id: true },
        })
      ).id;

    customerId = await creerClient('Magasin Principal');
    autreClientId = await creerClient('Magasin Voisin');

    const expedier = async (
      clientId: string,
      quantite: number,
      livree: boolean,
      suffixe: string
    ) => {
      const shipment = await prisma.shipment.create({
        data: {
          organization_id: orgId,
          id_client: clientId,
          shipment_id: `IT-RETRAIT-SHIP-${suffixe}-${Date.now()}`,
          date_envoi: new Date(),
          transporteur: 'TransFroid IT',
          statut_livraison: livree ? 'LIVRE' : 'EN_ROUTE',
          ...(livree ? { date_livraison: new Date(), delivered_by: userId } : {}),
          created_by: userId,
        },
        select: { id: true },
      });
      await prisma.liaison_Shipment.create({
        data: {
          id_expedition: shipment.id,
          id_lot: batchId,
          quantite_expediee: quantite,
          unite: unit.code,
        },
      });
    };

    // 40 livrés au client principal, 100 encore EN ROUTE : le plafond doit ignorer ces 100.
    await expedier(customerId, 40, true, 'LIVREE');
    await expedier(customerId, 100, false, 'EN-ROUTE');
    // Un autre client, livré lui aussi : son plafond doit rester indépendant.
    await expedier(autreClientId, 25, true, 'VOISIN');
  });

  afterAll(async () => {
    await prisma.withdrawal.deleteMany({ where: { organization_id: orgId } });
    await prisma.liaison_Shipment.deleteMany({ where: { lot: { organization_id: orgId } } });
    await prisma.batch_Mouvement.deleteMany({ where: { lot: { organization_id: orgId } } });
    await prisma.shipment.deleteMany({ where: { organization_id: orgId } });
    await prisma.customer.deleteMany({ where: { organization_id: orgId } });
    await prisma.batch.deleteMany({ where: { organization_id: orgId } });
    // Chaîne d'audit de l'organisation jetable, supprimée ENTIÈRE (jamais un maillon isolé).
    await prisma.audit_Log.deleteMany({ where: { organization_id: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  it('ne compte que la marchandise livrée, jamais celle encore en route', async () => {
    // 100 sont en route : si le plafond les comptait, ce retrait de 60 passerait.
    await expect(
      withdrawalService.recordWithdrawal(batchId, orgId, userId, {
        id_client: customerId,
        quantite: 60,
        motif: 'Tentative au-dela du livre',
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('accepte des retraits successifs jusqu’au plafond, puis refuse le dépassement', async () => {
    const premier = await withdrawalService.recordWithdrawal(batchId, orgId, userId, {
      id_client: customerId,
      quantite: 30,
      motif: 'Retrait du soir',
    });
    expect(premier.resteARetirer).toBe('10');

    const second = await withdrawalService.recordWithdrawal(batchId, orgId, userId, {
      id_client: customerId,
      quantite: 10,
      motif: 'Reserve videe le lendemain',
    });
    expect(second.resteARetirer).toBe('0');

    await expect(
      withdrawalService.recordWithdrawal(batchId, orgId, userId, {
        id_client: customerId,
        quantite: 1,
        motif: 'Un de trop',
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('garde les plafonds des clients indépendants', async () => {
    const voisin = await withdrawalService.recordWithdrawal(batchId, orgId, userId, {
      id_client: autreClientId,
      quantite: 25,
      motif: 'Retrait du magasin voisin',
    });

    expect(voisin.quantiteLivree).toBe('25');
    expect(voisin.resteARetirer).toBe('0');
  });

  it('rend, par client, le livré, le retiré et le reste', async () => {
    const clients = await withdrawalService.listWithdrawalsByCustomer(batchId, orgId);

    expect(clients.map((c) => c.customerName)).toEqual(['Magasin Principal', 'Magasin Voisin']);
    const principal = clients.find((c) => c.customerId === customerId);
    expect(principal).toMatchObject({ quantiteLivree: '40', quantiteRetiree: '40', resteARetirer: '0' });
    expect(principal?.retraits).toHaveLength(2);
  });

  it('refuse un client d’une AUTRE organisation, même s’il existe', async () => {
    // Le mutant qui retire `organization_id` du `where` du client survivait à tous les autres
    // tests : ils ne fabriquent qu'une organisation, donc la garde n'y sert jamais à rien.
    const autreOrgId = `it-retrait-autre-${Date.now()}`;
    await prisma.organization.create({
      data: {
        id: autreOrgId,
        name: 'IT Retrait Autre',
        slug: autreOrgId,
        createdAt: new Date(),
        metadata: '{}',
      },
    });
    const clientEtranger = await prisma.customer.create({
      data: {
        organization_id: autreOrgId,
        nom_enseigne: 'Magasin Etranger',
        adresse_livraison: '1 rue Ailleurs',
      },
      select: { id: true },
    });

    try {
      await expect(
        withdrawalService.recordWithdrawal(batchId, orgId, userId, {
          id_client: clientEtranger.id,
          quantite: 1,
          motif: 'Client hors organisation',
        })
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      await prisma.customer.deleteMany({ where: { organization_id: autreOrgId } });
      await prisma.organization.deleteMany({ where: { id: autreOrgId } });
    }
  });

  it('ne laisse pas deux déclarations simultanées dépasser le plafond', async () => {
    const lotConcurrent = (
      await prisma.batch.create({
        data: {
          organization_id: orgId,
          lot_number: `IT-RETRAIT-CONC-${Date.now()}`,
          id_produit: (await prisma.product.findFirstOrThrow({ select: { id: true } })).id,
          unite_code: (await prisma.unit.findFirstOrThrow({ select: { code: true } })).code,
          quantite_actuelle: 0,
          quantite_base: 40,
          created_by: userId,
        },
        select: { id: true },
      })
    ).id;

    const shipment = await prisma.shipment.create({
      data: {
        organization_id: orgId,
        id_client: customerId,
        shipment_id: `IT-RETRAIT-CONC-SHIP-${Date.now()}`,
        date_envoi: new Date(),
        transporteur: 'TransFroid IT',
        statut_livraison: 'LIVRE',
        date_livraison: new Date(),
        delivered_by: userId,
        created_by: userId,
      },
      select: { id: true },
    });
    await prisma.liaison_Shipment.create({
      data: {
        id_expedition: shipment.id,
        id_lot: lotConcurrent,
        quantite_expediee: 40,
        unite: (await prisma.unit.findFirstOrThrow({ select: { code: true } })).code,
      },
    });

    // Deux déclarations de 30 sur 40 livrés : leur somme dépasse, une seule doit aboutir.
    const resultats = await Promise.allSettled([
      withdrawalService.recordWithdrawal(lotConcurrent, orgId, userId, {
        id_client: customerId,
        quantite: 30,
        motif: 'Declaration simultanee A',
      }),
      withdrawalService.recordWithdrawal(lotConcurrent, orgId, userId, {
        id_client: customerId,
        quantite: 30,
        motif: 'Declaration simultanee B',
      }),
    ]);

    const reussites = resultats.filter((r) => r.status === 'fulfilled');
    expect(reussites).toHaveLength(1);

    const total = await prisma.withdrawal.aggregate({
      _sum: { quantite: true },
      where: { organization_id: orgId, id_lot: lotConcurrent },
    });
    expect(total._sum.quantite?.toString()).toBe('30');
  });
});
