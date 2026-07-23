/**
 * E2E — POST /api/sync/scans (mobile offline-first bulk endpoint).
 *
 * Pré-requis :
 * - DB Postgres up + migrations appliquées (npx prisma migrate dev --name add_idempotency_key)
 * - Seed exécuté : npx prisma db seed (crée org "usine-laitiere-paris", supplier, produits)
 * - .env contient API_KEY et API_KEY_ORG_ID="usine-laitiere-paris"
 * - API lancée : npm run dev (port 3000)
 *
 * Lancement : npm run e2e:sync
 *
 * Scénarios couverts (alignés sur le plan TDD de feat/mobile-sync-bulk) :
 *  1. Happy path     : 2 items valides → 207, 2 'ok' avec serverId
 *  2. Idempotency    : replay du même body → 207, 2 'ok' avec MÊMES serverId, 0 nouveau Receipt en DB
 *  3. Hash divergence: même clientOpId + payload modifié → 1 'conflict'
 *  4. Partial success: mix valide + FK ghost → 1 'ok' + 1 'error', le valide est commité
 *  5. Audit trail    : SELECT COUNT(*) FROM Audit_Log WHERE action='CREATE_RECEIPT_VIA_SYNC' croît
 *
 * Code de sortie 0 si tous les scénarios passent, 1 sinon.
 */
import { signInAsOperator } from './helpers/e2eSession';
import crypto from 'crypto';
import { prisma } from '../src/shared/configs/prismaClient.config';

const API_URL = process.env.API_URL || process.env.API_BASE || 'http://localhost:3000';
const API_KEY = process.env.API_KEY;
const ORG_ID = process.env.API_KEY_ORG_ID;

if (!API_KEY || !ORG_ID) {
  console.error('[E2E] API_KEY et API_KEY_ORG_ID requis dans .env');
  process.exit(1);
}

interface SyncItemResult {
  clientOpId: string;
  status: 'ok' | 'error' | 'conflict';
  serverId?: { receiptId: string; batchId: string };
  error?: { field: string; message: string };
}

interface SyncResponseBody {
  status: number;
  message: string;
  data: {
    results: SyncItemResult[];
    summary: { total: number; ok: number; error: number; conflict: number };
  };
}

const failures: string[] = [];

function assert(condition: boolean, label: string) {
  if (!condition) {
    failures.push(label);
    console.error(`  ❌ ${label}`);
  } else {
    console.log(`  ✅ ${label}`);
  }
}

/**
 * Le jeton de l'opérateur, comme le mobile réel. Ce script s'authentifiait avec la seule clé API :
 * il empruntait le chemin qui permettait d'écrire sans compte — celui qui n'existe plus.
 */
let sessionToken = '';

async function postSync(items: unknown[]): Promise<{ status: number; body: SyncResponseBody }> {
  const res = await fetch(`${API_URL}/api/sync/scans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({ items }),
  });
  const body = (await res.json()) as SyncResponseBody;
  return { status: res.status, body };
}

async function fetchFixtures() {
  // Récupère un supplier + un produit + un user membre dans l'org bound — pas d'hypothèse sur les UUID
  const supplier = await prisma.supplier.findFirst({ where: { organization_id: ORG_ID } });
  const product = await prisma.product.findFirst({ where: { organization_id: ORG_ID } });
  const member = await prisma.member.findFirst({ where: { organizationId: ORG_ID } });
  if (!supplier || !product || !member) {
    throw new Error(
      `Aucun supplier/product/member pour l'org ${ORG_ID}. Lance \`npx prisma db seed\` d'abord.`
    );
  }
  return { supplierId: supplier.id, productId: product.id, actorUserId: member.userId };
}

async function countReceiptsForShipment(shipmentId: string): Promise<number> {
  return prisma.receipt.count({ where: { shipment_id: shipmentId, organization_id: ORG_ID } });
}

async function countAudit(action: string): Promise<number> {
  return prisma.audit_Log.count({ where: { action, organization_id: ORG_ID } });
}

async function main() {
  console.log(`[E2E] Sync mobile bulk — API ${API_URL}, org ${ORG_ID}\n`);

  const { supplierId, productId } = await fetchFixtures();

  // Session d'operateur : le mobile reel envoie un jeton, jamais la cle sur les routes metier.
  const session = await signInAsOperator(prisma, {
    apiBase: API_URL,
    apiKey: API_KEY!,
    organizationId: ORG_ID!,
  });
  sessionToken = session.token;

  const baseReceipt = {
    id_fournisseur: supplierId,
    id_produit: productId,
    unite_code: 'L', // L est seedé via prisma/seed.ts
    statut_controle: 'OK',
  };

  const stamp = Date.now();
  const clientOpA = crypto.randomUUID();
  const clientOpB = crypto.randomUUID();
  const clientOpC = crypto.randomUUID();
  const shipmentA = `E2E-SYNC-${stamp}-A`;
  const shipmentB = `E2E-SYNC-${stamp}-B`;
  const shipmentC = `E2E-SYNC-${stamp}-C`;
  const ghostSupplierId = '99999999-9999-4999-8999-999999999999';

  const auditBefore = await countAudit('CREATE_RECEIPT_VIA_SYNC');

  // ─── Scénario 1 : Happy path ───────────────────────────────────────
  console.log('Scénario 1 — Happy path (2 items valides)');
  const items1 = [
    { clientOpId: clientOpA, type: 'receipt', payload: { ...baseReceipt, shipment_id: shipmentA, quantite_actuelle: 100 } },
    { clientOpId: clientOpB, type: 'receipt', payload: { ...baseReceipt, shipment_id: shipmentB, quantite_actuelle: 250 } },
  ];
  const r1 = await postSync(items1);
  if (r1.status !== 207) {
    console.error('  ⚠ Body reçu (non-207):', JSON.stringify(r1.body, null, 2));
  }
  assert(r1.status === 207, `HTTP 207 (reçu: ${r1.status})`);
  if (!r1.body?.data) {
    console.error('  ⚠ Pas de body.data — arrêt anticipé pour diagnostic.');
    return;
  }
  assert(r1.body.data.summary.ok === 2, 'summary.ok === 2');
  assert(r1.body.data.summary.error === 0, 'summary.error === 0');
  assert(r1.body.data.summary.conflict === 0, 'summary.conflict === 0');
  assert(r1.body.data.results.every((r) => r.status === 'ok'), 'tous les items en status ok');
  assert(!!r1.body.data.results[0].serverId?.receiptId, 'serverId.receiptId défini sur item 0');
  const cntA1 = await countReceiptsForShipment(shipmentA);
  assert(cntA1 === 1, `1 receipt créé pour ${shipmentA} (cnt=${cntA1})`);

  // ─── Scénario 2 : Idempotency replay (même body) ───────────────────
  console.log('\nScénario 2 — Idempotency replay (même body)');
  const r2 = await postSync(items1);
  assert(r2.status === 207, 'HTTP 207');
  assert(r2.body.data.summary.ok === 2, 'replay summary.ok === 2');
  const sameId = r2.body.data.results[0].serverId?.receiptId === r1.body.data.results[0].serverId?.receiptId;
  assert(sameId, 'serverId.receiptId identique au 1er appel');
  const cntA2 = await countReceiptsForShipment(shipmentA);
  assert(cntA2 === 1, `Toujours 1 receipt en DB pour ${shipmentA} (pas de doublon)`);

  // ─── Scénario 3 : Hash divergence → conflict ───────────────────────
  console.log('\nScénario 3 — Hash divergence (même clientOpId, payload modifié)');
  const items3 = [
    {
      clientOpId: clientOpA, // même clientOpId que scénario 1
      type: 'receipt',
      payload: { ...baseReceipt, shipment_id: shipmentA, quantite_actuelle: 999 }, // quantité modifiée
    },
  ];
  const r3 = await postSync(items3);
  assert(r3.status === 207, 'HTTP 207');
  assert(r3.body.data.summary.conflict === 1, 'summary.conflict === 1');
  assert(r3.body.data.results[0].status === 'conflict', "status='conflict'");
  assert(r3.body.data.results[0].error?.field === 'clientOpId', "error.field === 'clientOpId'");

  // ─── Scénario 4 : Partial success ──────────────────────────────────
  console.log('\nScénario 4 — Partial success (1 valide + 1 FK ghost)');
  const items4 = [
    { clientOpId: clientOpC, type: 'receipt', payload: { ...baseReceipt, shipment_id: shipmentC, quantite_actuelle: 50 } },
    {
      clientOpId: crypto.randomUUID(),
      type: 'receipt',
      payload: { ...baseReceipt, id_fournisseur: ghostSupplierId, shipment_id: `${shipmentC}-bad`, quantite_actuelle: 50 },
    },
  ];
  const r4 = await postSync(items4);
  assert(r4.status === 207, 'HTTP 207');
  assert(r4.body.data.summary.ok === 1, 'summary.ok === 1');
  assert(r4.body.data.summary.error === 1, 'summary.error === 1');
  assert(r4.body.data.results[0].status === 'ok', 'item 0 = ok');
  assert(r4.body.data.results[1].status === 'error', 'item 1 = error');
  assert(r4.body.data.results[1].error?.field === 'id_fournisseur', "error.field === 'id_fournisseur'");
  const cntC = await countReceiptsForShipment(shipmentC);
  assert(cntC === 1, `1 receipt créé pour ${shipmentC} (le valide est commité)`);

  // ─── Scénario 5 : Audit trail ──────────────────────────────────────
  console.log('\nScénario 5 — Audit WORM trail');
  const auditAfter = await countAudit('CREATE_RECEIPT_VIA_SYNC');
  // 3 succès cumulés (2 scénario 1 + 1 scénario 4 ; le replay ne crée pas d'audit)
  assert(
    auditAfter - auditBefore === 3,
    `+3 lignes Audit_Log action='CREATE_RECEIPT_VIA_SYNC' (avant=${auditBefore}, après=${auditAfter})`
  );
}

main()
  .catch((err) => {
    console.error('\n[E2E] Erreur fatale:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    if (failures.length > 0) {
      console.error(`\n❌ ${failures.length} échec(s) :`);
      failures.forEach((f) => console.error(`   - ${f}`));
      process.exitCode = 1;
    } else {
      console.log('\n✅ Tous les scénarios E2E sync mobile sont passés.');
    }
  });
