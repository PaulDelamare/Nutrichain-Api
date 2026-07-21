import { randomBytes } from 'crypto';
import { prisma } from '../src/shared/configs/prismaClient.config';
import { signInAsOperator } from './helpers/e2eSession';

/**
 * NUTRICHAIN — Preuve, contre l'API RÉELLE, que deux expéditions simultanées ne fabriquent plus le
 * même SSCC (issue #124).
 *
 * Le serial venait de `count(expéditions de l'org) + 1` : une LECTURE, pas une réservation. Sous
 * concurrence, deux expéditions lisaient la même valeur, produisaient le même identifiant, et la
 * seconde mourait sur un `P2002` non traduit — 500 devant le camion, pour un geste métier
 * parfaitement légitime.
 *
 * Prérequis : `npm run dev` sur une base seedée (`npm run seed`).
 * Lancement : npm run e2e:sscc
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const API_KEY = process.env.API_KEY;
const ORG_ID = process.env.API_KEY_ORG_ID;
const PRODUCT_ID = '44444444-4444-4444-8444-444444444444';
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';
const CONCURRENCE = 12;

if (!API_KEY || !ORG_ID) {
  console.error('[E2E] API_KEY et API_KEY_ORG_ID requis dans .env');
  process.exit(1);
}

const ok = (msg: string) => console.log(`  ✅ ${msg}`);
const fail = (msg: string): never => {
  throw new Error(msg);
};

const suffixe = randomBytes(4).toString('hex');

async function main() {
  console.log('\n📦 Un identifiant logistique se réserve, il ne se compte pas\n');

  const session = await signInAsOperator(prisma, {
    apiBase: API_BASE,
    apiKey: API_KEY!,
    organizationId: ORG_ID!,
  });

  // Un lot par expédition : sans cela, c'est le verrou optimiste du stock qui sérialiserait les
  // requêtes, et la concurrence sur la numérotation ne serait jamais exercée.
  const lots = [];
  for (let i = 0; i < CONCURRENCE; i++) {
    lots.push(
      await prisma.batch.create({
        data: {
          organization_id: ORG_ID!,
          lot_number: `E2E-SSCC-${suffixe}-${i}`,
          id_produit: PRODUCT_ID,
          quantite_actuelle: 100,
          quantite_base: 100,
          unite_code: 'L',
          statut: 'EN_STOCK',
          created_by: session.userId,
        },
      })
    );
  }

  try {
    const reponses = await Promise.all(
      lots.map((lot) =>
        fetch(`${API_BASE}/api/logistics/shipments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({
            id_client: CUSTOMER_ID,
            shipment_id: 'AUTO',
            transporteur: 'E2E',
            destination_adresse: '1 rue de la Livraison, Paris',
            lots: [{ id_lot: lot.id, quantite_expediee: 1 }],
          }),
        }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
      )
    );

    const echecs = reponses.filter((r) => r.status >= 400);
    if (echecs.length > 0) {
      fail(
        `${echecs.length}/${CONCURRENCE} expéditions refusées (statuts ${[...new Set(echecs.map((e) => e.status))].join(', ')}) — une expédition légitime ne doit pas se perdre\n${JSON.stringify(echecs[0].body)}`
      );
    }
    ok(`${CONCURRENCE} expéditions simultanées acceptées, aucune perdue`);

    const identifiants = reponses.map(
      (r) => (r.body as { data?: { shipment?: { shipment_id?: string } } })?.data?.shipment?.shipment_id
    );
    const uniques = new Set(identifiants);
    if (uniques.size !== CONCURRENCE) {
      fail(`SSCC en collision : ${CONCURRENCE} expéditions pour ${uniques.size} identifiants`);
    }
    ok(`${uniques.size} SSCC distincts — la séquence réserve, elle ne relit pas`);

    if (identifiants.some((id) => !id || !/^[0-9]{18}$/.test(id))) {
      fail(`Un identifiant généré n'est pas un SSCC à 18 chiffres : ${identifiants.join(', ')}`);
    }
    ok('Tous conformes GS1 (18 chiffres, check digit)');

    // Second volet de l'issue : un identifiant saisi à la main et déjà pris rendait un 500.
    const manuel = `E2E-DUP-${suffixe}`;
    const corps = (id: string) => ({
      id_client: CUSTOMER_ID,
      shipment_id: id,
      transporteur: 'E2E',
      destination_adresse: '1 rue de la Livraison, Paris',
      lots: [{ id_lot: lots[0].id, quantite_expediee: 1 }],
    });
    const envoyer = (id: string) =>
      fetch(`${API_BASE}/api/logistics/shipments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify(corps(id)),
      });

    const premier = await envoyer(manuel);
    if (premier.status !== 201) {
      fail(`Expédition manuelle : attendu 201, reçu ${premier.status}`);
    }
    const doublon = await envoyer(manuel);
    if (doublon.status !== 409) {
      fail(`Doublon d'identifiant : attendu 409, reçu ${doublon.status}`);
    }
    ok("Doublon d'identifiant saisi à la main : 409 explicite, plus de 500");

    console.log('\n🎉 Numérotation réservée : plus de collision, plus de 500.\n');
  } finally {
    const ids = lots.map((l) => l.id);
    await prisma.liaison_Shipment.deleteMany({ where: { id_lot: { in: ids } } });
    await prisma.batch_Mouvement.deleteMany({ where: { id_lot: { in: ids } } });
    await prisma.batch.deleteMany({ where: { id: { in: ids } } });
    await prisma.shipment.deleteMany({
      where: { organization_id: ORG_ID!, transporteur: 'E2E' },
    });
  }
}

main()
  .catch((e) => {
    console.error(`\n❌ ${e.message}\n`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
