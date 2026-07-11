/**
 * E2E — le parcours RÉEL de l'application mobile, en session Bearer.
 *
 * Le e2e existant (`e2e:sync`) couvre le mode machine-à-machine : clé API + actorUserId.
 * Le mobile, lui, s'authentifie comme un utilisateur — et c'est ce chemin-là qui était
 * cassé : `mixedAuth` basculait en M2M à la simple vue du header `x-api-key`, ignorait la
 * session, réclamait un actorUserId absent (400 sur tout le lot), et bornait l'organisation
 * à celle de la clé. Aucun scan n'atteignait la base.
 *
 * Ce script rejoue donc exactement ce que fait le client mobile :
 *   - clé API sur /api/auth/* uniquement (l'API l'exige là, et nulle part ailleurs)
 *   - Bearer seul sur les routes métier
 *
 * Pré-requis : API lancée (npm run dev), base seedée, .env complet.
 * Lancement : npm run e2e:mobile
 */
import crypto from 'crypto';
import http from 'http';
import { prisma } from '../src/shared/configs/prismaClient.config';

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const API_KEY = process.env.API_KEY;
const EMAIL = process.env.E2E_EMAIL || 'first.admin@nutrichain.local';
const PASSWORD = process.env.E2E_PASSWORD || 'NutriChain!2026';

if (!API_KEY) {
  console.error('[E2E] API_KEY requis dans .env');
  process.exit(1);
}

const failures: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✅ ${label}`);
  } else {
    failures.push(label);
    console.error(`  ❌ ${label}`);
  }
}

/**
 * `fetch` (undici) pose un `Sec-Fetch-Mode: cors` que Better-Auth interprète comme un appel
 * navigateur — il exige alors un `Origin`, qu'une app native n'envoie jamais. On passe donc
 * par `http` brut pour n'émettre QUE les en-têtes du vrai client mobile.
 *
 * Et la clé API n'accompagne que /api/auth/* : ailleurs, elle ferait basculer l'API en mode
 * machine-à-machine et l'organisation servie ne serait plus celle de l'utilisateur.
 */
function callApi(
  path: string,
  token: string | null,
  init: { method?: string; body?: string } = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (path.startsWith('/api/auth/')) {
    headers['x-api-key'] = API_KEY!;
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (init.body) {
    headers['Content-Length'] = String(Buffer.byteLength(init.body));
  }

  const url = new URL(`${API_BASE}${path}`);

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: init.method ?? 'GET',
        headers,
      },
      (response) => {
        let raw = '';
        response.on('data', (chunk) => (raw += chunk));
        response.on('end', () => {
          let body: Record<string, unknown> = {};
          try {
            body = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            // Corps non JSON : les assertions sur le statut restent exploitables.
          }
          resolve({ status: response.statusCode ?? 0, body });
        });
      }
    );

    request.on('error', reject);
    if (init.body) request.write(init.body);
    request.end();
  });
}

async function main(): Promise<void> {
  console.log('\n🔐 1. Connexion (comme l’écran de login)');
  const signIn = await callApi('/api/auth/sign-in/email', null, {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const token = signIn.body.token as string | undefined;
  assert(signIn.status === 200, `sign-in répond 200 (reçu ${signIn.status})`);
  assert(Boolean(token), 'un jeton de session est renvoyé dans le corps');
  if (!token) throw new Error('Sans jeton, le reste du parcours est impossible.');

  console.log('\n👤 2. Identité et organisation active (écrans profil / accueil)');
  const me = await callApi('/api/me', token);
  const meData = (me.body.data ?? {}) as { user?: { id: string }; activeOrgId?: string };
  assert(me.status === 200, `/api/me répond 200 (reçu ${me.status})`);
  assert(Boolean(meData.activeOrgId), 'une organisation active est résolue pour la session');
  const userId = meData.user?.id;
  const orgId = meData.activeOrgId;

  console.log('\n📦 3. Catalogue (formulaire de réception)');
  const suppliers = await callApi('/api/organization/suppliers', token);
  const products = await callApi('/api/traceability/products', token);
  const supplierList = (suppliers.body.data ?? []) as { id: string; organization_id: string }[];
  const productList = (products.body.data ?? []) as {
    id: string;
    organization_id: string;
    unite_reference: string;
  }[];

  assert(suppliers.status === 200, `fournisseurs accessibles en session (reçu ${suppliers.status})`);
  assert(products.status === 200, `produits accessibles en session (reçu ${products.status})`);
  assert(supplierList.length > 0 && productList.length > 0, 'le catalogue est peuplé');

  // La régression multi-tenant : sans le correctif, l'organisation servie était celle de la
  // clé API (API_KEY_ORG_ID), pas celle de l'utilisateur connecté.
  assert(
    supplierList.every((supplier) => supplier.organization_id === orgId),
    "les données servies appartiennent à l'organisation de l'utilisateur, pas à celle de la clé API"
  );

  if (supplierList.length === 0 || productList.length === 0) {
    throw new Error('Catalogue vide : lancer le seed avant ce script.');
  }

  console.log('\n📡 4. Synchronisation d’un scan (le cœur du besoin mobile)');
  const clientOpId = crypto.randomUUID();
  const product = productList[0];
  const payload = {
    id_fournisseur: supplierList[0].id,
    shipment_id: `E2E-MOBILE-${Date.now()}`,
    id_produit: product.id,
    quantite_actuelle: 42,
    unite_code: product.unite_reference,
    statut_controle: 'OK',
  };

  const sync = await callApi('/api/sync/scans', token, {
    method: 'POST',
    body: JSON.stringify({ items: [{ clientOpId, type: 'receipt', payload }] }),
  });
  const syncData = (sync.body.data ?? {}) as {
    results?: { clientOpId: string; status: string; serverId?: { receiptId: string } }[];
  };
  const [result] = syncData.results ?? [];

  assert(sync.status === 207, `la synchronisation répond 207 (reçu ${sync.status})`);
  assert(result?.status === 'ok', `le scan est accepté (statut : ${result?.status ?? 'aucun'})`);
  assert(Boolean(result?.serverId?.receiptId), 'un identifiant serveur est renvoyé');

  console.log('\n🗄️  5. Le scan est réellement en base');
  const receipts = await prisma.receipt.findMany({ where: { shipment_id: payload.shipment_id } });
  assert(receipts.length === 1, `une réception exactement est enregistrée (trouvé ${receipts.length})`);
  assert(
    receipts[0]?.organization_id === orgId,
    "la réception est rattachée à l'organisation de l'utilisateur"
  );
  assert(
    receipts[0]?.received_by === userId,
    "l'opérateur enregistré est l'utilisateur connecté (received_by forcé côté serveur)"
  );

  console.log('\n🔁 6. Rejeu du même scan (perte réseau, retry) : aucun doublon');
  const replay = await callApi('/api/sync/scans', token, {
    method: 'POST',
    body: JSON.stringify({ items: [{ clientOpId, type: 'receipt', payload }] }),
  });
  const replayData = (replay.body.data ?? {}) as {
    results?: { status: string; serverId?: { receiptId: string } }[];
  };

  assert(replayData.results?.[0]?.status === 'ok', 'le rejeu est accepté');
  assert(
    replayData.results?.[0]?.serverId?.receiptId === result?.serverId?.receiptId,
    'le rejeu renvoie le MÊME identifiant serveur (idempotence)'
  );

  const afterReplay = await prisma.receipt.count({ where: { shipment_id: payload.shipment_id } });
  assert(afterReplay === 1, `toujours une seule réception en base (trouvé ${afterReplay})`);

  console.log('\n🚫 7. Une opération invalide est rejetée, pas réessayée en boucle');
  const invalid = await callApi('/api/sync/scans', token, {
    method: 'POST',
    body: JSON.stringify({
      items: [
        {
          clientOpId: crypto.randomUUID(),
          type: 'receipt',
          payload: { ...payload, id_fournisseur: crypto.randomUUID() },
        },
      ],
    }),
  });
  const invalidData = (invalid.body.data ?? {}) as {
    results?: { status: string; error?: { field: string } }[];
  };

  assert(invalid.status === 207, 'un fournisseur inexistant ne fait pas échouer la requête entière');
  assert(
    invalidData.results?.[0]?.status === 'error',
    `l'opération est rejetée (statut : ${invalidData.results?.[0]?.status ?? 'aucun'})`
  );
  assert(
    invalidData.results?.[0]?.error?.field !== 'internal',
    "l'erreur est permanente, donc le mobile ne la réessaiera pas indéfiniment"
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
    if (failures.length > 0) {
      console.error(`\n❌ ${failures.length} vérification(s) en échec :`);
      failures.forEach((failure) => console.error(`   - ${failure}`));
      process.exit(1);
    }
    console.log('\n✅ Le parcours mobile complet fonctionne contre l’API réelle.\n');
  })
  .catch(async (error: unknown) => {
    await prisma.$disconnect();
    console.error('\n💥 Échec :', error);
    process.exit(1);
  });
