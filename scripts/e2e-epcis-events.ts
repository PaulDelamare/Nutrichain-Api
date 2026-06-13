import { prisma } from '../src/shared/configs/prismaClient.config';

// Configuration
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || '';
const API_KEY_ORG_ID = process.env.API_KEY_ORG_ID || '';

// Fixtures rattachées à l'organisation de la clé API (mode M2M) pour respecter le multi-tenant.
const SUPPLIER_ID = '123e4567-e89b-12d3-a456-426614174000';
const PRODUCT_ID = '123e4567-e89b-12d3-a456-426614174001';
const USER_ID = '123e4567-e89b-12d3-a456-426614174099';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}

async function seed() {
  await prisma.supplier.upsert({
    where: { id: SUPPLIER_ID },
    update: {},
    create: {
      id: SUPPLIER_ID,
      organization_id: API_KEY_ORG_ID,
      nom_ferme: 'Ferme EPCIS Test',
      adresse_siege: 'Adresse Test',
    },
  });
  await prisma.product.upsert({
    where: { id: PRODUCT_ID },
    update: {},
    create: {
      id: PRODUCT_ID,
      organization_id: API_KEY_ORG_ID,
      nom: 'Produit EPCIS Test',
      categorie: 'Test',
      duree_conservation_defaut: 365,
      seuil_alerte_stock: 0,
      unite_reference: 'KG',
    },
  });
  await prisma.user.upsert({
    where: { id: USER_ID },
    update: {},
    create: { id: USER_ID, email: 'epcis.user@example.com', name: 'EPCIS User' },
  });
  await prisma.unit.upsert({
    where: { code: 'KG' },
    update: {},
    create: { code: 'KG', nom: 'Kilogramme', factor_to_base: 1 },
  });
}

async function postReceipt() {
  const payload = {
    id_fournisseur: SUPPLIER_ID,
    shipment_id: `EPCIS-E2E-${Date.now()}`,
    id_produit: PRODUCT_ID,
    quantite_actuelle: 42,
    unite_code: 'KG',
    statut_controle: 'OK',
    received_by: USER_ID,
  };

  const res = await fetch(`${API_BASE}/api/logistics/receipts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => null);
  console.log('POST /receipts ->', res.status);
  return { status: res.status, body };
}

async function main() {
  if (!API_KEY_ORG_ID) {
    console.error('API_KEY_ORG_ID manquant : impossible de vérifier le cloisonnement EPCIS. Abandon.');
    process.exit(1);
  }

  let receiptId: string | undefined;
  let batchId: string | undefined;

  try {
    console.log('Seeding fixtures...');
    await seed();

    console.log('Scénario : une réception émet un ObjectEvent EPCIS cloisonné par organisation');
    const post = await postReceipt();
    assert(post.status === 201, 'POST /receipts retourne 201');

    receiptId = post.body?.data?.receiptId || post.body?.receiptId;
    batchId = post.body?.data?.batchId || post.body?.batchId;
    assert(Boolean(receiptId), 'receiptId présent dans la réponse');

    const events = await prisma.ePCIS_Event.findMany({
      where: { related_entity: 'Receipt', related_id: receiptId },
    });

    assert(events.length === 1, 'exactement 1 EPCIS_Event lié à la réception');
    const event = events[0];

    if (event) {
      assert(event.event_type === 'ObjectEvent', "event_type === 'ObjectEvent'");
      assert(
        event.organization_id === API_KEY_ORG_ID,
        'organization_id de l événement === org de la clé API (cloisonnement multi-tenant)'
      );
      const payload = event.payload as Record<string, unknown>;
      assert(payload?.bizStep === 'urn:epcglobal:cbv:bizstep:receiving', 'bizStep GS1 receiving');
      assert(
        Array.isArray(payload?.epcList) && (payload.epcList as unknown[])[0] === batchId,
        'epcList contient le lot créé'
      );
    }
  } catch (e) {
    failed++;
    console.error('E2E error:', e);
  } finally {
    if (receiptId) {
      await prisma.ePCIS_Event.deleteMany({ where: { related_entity: 'Receipt', related_id: receiptId } });
      await prisma.receipt.deleteMany({ where: { id: receiptId } });
    }
    if (batchId) await prisma.batch.deleteMany({ where: { id: batchId } });
    console.log('Cleanup done.');
    await prisma.$disconnect();
  }

  console.log(`\nRésultat E2E EPCIS : ${passed} OK / ${failed} KO`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
