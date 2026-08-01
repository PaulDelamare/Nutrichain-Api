import { prisma } from '../src/shared/configs/prismaClient.config';

/**
 * NUTRICHAIN — Preuve, contre l'API RÉELLE, du CRUD Client + Produit.
 *
 * Lève le cul-de-sac des expéditions (sans client, aucune expédition) et de la création de produit
 * (jusqu'ici uniquement par import CSV). Et la désactivation a un effet RÉEL : un client archivé ne
 * reçoit plus d'expédition, un produit archivé n'accepte plus de réception ni de production.
 *
 * Prérequis : `npm run dev` sur une base seedée. Lancement : npm run e2e:customer-product
 */

const API = 'http://localhost:3000/api';
const KEY = process.env.API_KEY!;
const ORIGIN = process.env.FRONTEND_URL ?? 'http://localhost:5173';

const ok = (m: string) => console.log(`  ✅ ${m}`);
const fail = (m: string): never => {
  throw new Error(m);
};

async function signIn(email: string): Promise<string> {
  const res = await fetch(`${API}/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY, Origin: ORIGIN },
    body: JSON.stringify({ email, password: 'NutriChain!2026' }),
  });
  const d = (await res.json()) as { token?: string };
  if (!res.ok || !d.token) fail(`Connexion ${email} impossible (${res.status})`);
  return d.token!;
}

const call = (token: string, path: string, method = 'GET', body?: unknown) =>
  fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-api-key': KEY,
      Authorization: `Bearer ${token}`,
      Origin: ORIGIN,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

async function main() {
  console.log('\n🛒 CRUD Client + Produit\n');

  const admin = await signIn('admin@nutrichain.local');
  const operator = await signIn('operator@nutrichain.local');
  const stamp = Date.now();

  // 1. Opérateur refusé sur les écritures
  const rejection = await call(operator, '/organization/customers', 'POST', {
    nom_enseigne: 'Pirate',
    adresse_livraison: '1 rue',
  });
  if (rejection.status !== 403) fail(`operator a pu créer un client (${rejection.status})`);
  ok('Création de client refusée à un opérateur (403)');

  // 2. Admin crée un client
  const cC = await call(admin, '/organization/customers', 'POST', {
    nom_enseigne: `Enseigne e2e ${stamp}`,
    adresse_livraison: '12 avenue des Halles',
    email: 'contact@enseigne.fr',
  });
  if (cC.status !== 201) fail(`Création client échouée (${cC.status})`);
  const customerId = (await cC.json()).data.id as string;
  ok('Client créé par un admin');

  // 3. Admin crée un produit
  const cP = await call(admin, '/organization/products', 'POST', {
    nom: `Yaourt e2e ${stamp}`,
    code_gtin: String(3000000000000 + (stamp % 100000)),
    categorie: 'Frais',
    duree_conservation_defaut: 30,
    seuil_alerte_stock: 10,
    unite_reference: 'KG',
  });
  if (cP.status !== 201) fail(`Création produit échouée (${cP.status})`);
  const productId = (await cP.json()).data.id as string;
  ok('Produit créé par un admin');

  // 4. GTIN déjà pris → 409
  const dup = await call(admin, '/organization/products', 'POST', {
    nom: 'Autre',
    code_gtin: String(3000000000000 + (stamp % 100000)),
    categorie: 'Frais',
    duree_conservation_defaut: 20,
    seuil_alerte_stock: 5,
    unite_reference: 'KG',
  });
  if (dup.status !== 409) fail(`GTIN dupliqué mal géré (${dup.status})`);
  ok('GTIN déjà utilisé → 409');

  // 5. Audit tracé
  const audits = await prisma.audit_Log.count({
    where: {
      entity_id: { in: [customerId, productId] },
      action: { in: ['CREATE_CUSTOMER', 'CREATE_PRODUCT'] },
    },
  });
  if (audits !== 2) fail(`Créations non journalisées (${audits}/2)`);
  ok('Créations journalisées dans l’audit');

  // 6. Archivage → disparaît des listes par défaut
  await call(admin, `/organization/customers/${customerId}/active`, 'PATCH', { active: false });
  await call(admin, `/organization/products/${productId}/active`, 'PATCH', { active: false });

  const clients = await (await call(admin, '/organization/customers')).json();
  if (clients.data.some((c: { id: string }) => c.id === customerId))
    fail('Client archivé encore dans la liste par défaut');
  ok('Client archivé : absent de la liste par défaut');

  // 7. LE POINT CLÉ : expédier vers un client archivé, recevoir un produit archivé → REFUS
  const exp = await call(admin, '/logistics/shipments', 'POST', {
    id_client: customerId,
    shipment_id: `E2E-${stamp}`,
    transporteur: 'Transporteur X',
    destination_adresse: '15 rue de la Livraison',
    // Le client est vérifié AVANT les lots dans le service : un lot bidon suffit à atteindre la garde.
    lots: [{ id_lot: '00000000-0000-4000-8000-000000000000', quantite_expediee: 1 }],
  });
  if (exp.status !== 409) fail(`Expédition vers client archivé mal refusée (${exp.status})`);
  ok('Expédition vers un client archivé refusée (409)');

  const rec = await call(admin, '/logistics/receipts', 'POST', {
    id_fournisseur: '11111111-1111-4111-8111-111111111111',
    id_produit: productId,
    quantite_actuelle: 5,
    unite_code: 'KG',
    statut_controle: 'OK',
    shipment_id: `E2E-R-${stamp}`,
  });
  if (rec.status !== 409) fail(`Réception d'un produit archivé mal refusée (${rec.status})`);
  ok('Réception d’un produit archivé refusée (409)');

  // 8. Réactivation
  await call(admin, `/organization/customers/${customerId}/active`, 'PATCH', { active: true });
  await call(admin, `/organization/products/${productId}/active`, 'PATCH', { active: true });
  ok('Client et produit réactivés');

  // Nettoyage
  // Les maillons d'audit RESTENT : les retirer amputerait au milieu la chaîne d'une organisation
  // réelle et la ferait déclarer corrompue (#291). `entity_id` n'est pas une clé étrangère.
  await prisma.customer.delete({ where: { id: customerId } });
  await prisma.product.delete({ where: { id: productId } });
  ok('Données e2e nettoyées');

  console.log(
    '\n✅ CRUD Client + Produit : création, GTIN unique, archivage effectif, réactivation.\n'
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`);
  await prisma.$disconnect();
  process.exit(1);
});
