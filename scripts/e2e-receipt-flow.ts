import { prisma } from '../src/shared/configs/prismaClient.config';

// Configuration
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || '';

async function seed() {
  await prisma.supplier.upsert({
    where: { id: '123e4567-e89b-12d3-a456-426614174000' },
    update: {},
    create: { id: '123e4567-e89b-12d3-a456-426614174000', nom_ferme: 'Ferme Test', adresse_siege: 'Adresse Test' },
  });
  await prisma.product.upsert({
    where: { id: '123e4567-e89b-12d3-a456-426614174001' },
    update: {},
    create: {
      id: '123e4567-e89b-12d3-a456-426614174001',
      nom: 'Produit Test',
      categorie: 'Test',
      duree_conservation_defaut: 365,
      seuil_alerte_stock: 0,
      unite_reference: 'KG',
    },
  });
  await prisma.user.upsert({
    where: { id: '123e4567-e89b-12d3-a456-426614174099' },
    update: {},
    create: { id: '123e4567-e89b-12d3-a456-426614174099', email: 'test.user@example.com', name: 'Test User' },
  });
  await prisma.unit.upsert({
    where: { code: 'KG' },
    update: {},
    create: { code: 'KG', nom: 'Kilogramme', factor_to_base: 1 },
  });
}

async function postReceipt() {
  const payload = {
    id_fournisseur: '123e4567-e89b-12d3-a456-426614174000',
    shipment_id: `E2E-${Date.now()}`,
    id_produit: '123e4567-e89b-12d3-a456-426614174001',
    quantite_actuelle: 42,
    unite_code: 'KG',
    statut_controle: 'OK',
    received_by: '123e4567-e89b-12d3-a456-426614174099',
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
  console.log('POST /receipts ->', res.status, body);
  return { status: res.status, body };
}

async function getReceipt(id: string) {
  const res = await fetch(`${API_BASE}/api/logistics/receipts/${id}`, {
    headers: { ...(API_KEY ? { 'x-api-key': API_KEY } : {}) },
  });
  const body = await res.json().catch(() => null);
  console.log(`GET /receipts/${id} ->`, res.status, body);
  return { status: res.status, body };
}

async function getBatch(id: string) {
  const res = await fetch(`${API_BASE}/api/logistics/batches/${id}`, {
    headers: { ...(API_KEY ? { 'x-api-key': API_KEY } : {}) },
  });
  const body = await res.json().catch(() => null);
  console.log(`GET /batches/${id} ->`, res.status, body);
  return { status: res.status, body };
}

async function getStats() {
  const res = await fetch(`${API_BASE}/api/logistics/receipts/stats`, {
    headers: { ...(API_KEY ? { 'x-api-key': API_KEY } : {}) },
  });
  const body = await res.json().catch(() => null);
  console.log('GET /receipts/stats ->', res.status, body);
  return { status: res.status, body };
}

async function cleanup(ids: { receiptId?: string; batchId?: string }) {
  try {
    if (ids.receiptId) await prisma.receipt.deleteMany({ where: { id: ids.receiptId } });
    if (ids.batchId) await prisma.batch.deleteMany({ where: { id: ids.batchId } });
    // Leave supplier/product/user for now (optional cleanup)
    console.log('Cleanup done.');
  } catch (e) {
    console.error('Cleanup error:', e);
  }
}

async function main() {
  try {
    console.log('Seeding fixtures...');
    await seed();

    console.log('Posting receipt to API...');
    const post = await postReceipt();

    let receiptId: string | undefined;
    let batchId: string | undefined;

    if (post.body && typeof post.body === 'object') {
      // Try common locations for ids
      receiptId = post.body.receiptId || post.body.data?.receiptId || post.body.data?.receipt?.id;
      batchId = post.body.batchId || post.body.data?.batchId || post.body.data?.batch?.id;
    }

    if (receiptId) await getReceipt(receiptId);
    if (batchId) await getBatch(batchId);
    await getStats();

    console.log('Cleaning up created receipt/batch...');
    await cleanup({ receiptId, batchId });
  } catch (e) {
    console.error('E2E error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
