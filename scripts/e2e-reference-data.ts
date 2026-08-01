import { prisma } from '../src/shared/configs/prismaClient.config';

/**
 * NUTRICHAIN — Preuve, contre l'API RÉELLE, du CRUD des données de référence.
 *
 * Deux culs-de-sac levés : sans fournisseur aucune réception, sans emplacement `POST /equipment`
 * echoue. Et la désactivation a un effet RÉEL : un fournisseur archivé ne reçoit plus (garde sur le
 * chemin d'écriture, pas seulement la liste).
 *
 * Prérequis : `npm run dev` sur une base seedée. Lancement : npm run e2e:reference-data
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
  console.log('\n🏭 CRUD données de référence — fournisseur & emplacement\n');

  const admin = await signIn('admin@nutrichain.local');
  const operator = await signIn('operator@nutrichain.local');

  const created: string[] = [];

  // 1. Un opérateur ne configure pas : 403 sur les écritures
  const rejection = await call(operator, '/organization/suppliers', 'POST', {
    nom_ferme: 'Ferme Pirate',
    adresse_siege: '1 rue',
  });
  if (rejection.status !== 403) fail(`Un operator a pu créer un fournisseur (${rejection.status})`);
  ok('Création de fournisseur refusée à un opérateur (403)');

  // 2. L'admin crée un fournisseur et un emplacement
  const cS = await call(admin, '/organization/suppliers', 'POST', {
    nom_ferme: `Ferme e2e ${Date.now()}`,
    adresse_siege: '2 chemin des prés',
    type_produit: 'Lait cru',
  });
  if (cS.status !== 201) fail(`Création fournisseur échouée (${cS.status})`);
  const supplierId = (await cS.json()).data.id as string;
  created.push(supplierId);
  ok('Fournisseur créé par un admin');

  const cL = await call(admin, '/organization/locations', 'POST', {
    nom: `Quai e2e ${Date.now()}`,
    type: 'RECEPTION',
    latitude: 48.83291,
    longitude: 2.28654,
  });
  if (cL.status !== 201) fail(`Création emplacement échouée (${cL.status})`);
  const locationId = (await cL.json()).data.id as string;
  ok('Emplacement créé par un admin');

  // 2 bis. La position du lieu est une donnée SAISIE, pas déduite d'un nom (cf. #23). On prouve
  // qu'elle est persistée telle quelle, que la moitié d'un couple est refusée, et qu'on peut
  // l'effacer — sinon la fiche lot afficherait un repère sans savoir d'où il vient.
  const stored = await prisma.location.findUniqueOrThrow({ where: { id: locationId } });
  if (Number(stored.latitude) !== 48.83291 || Number(stored.longitude) !== 2.28654)
    fail(`Coordonnées non persistées (${stored.latitude}, ${stored.longitude})`);
  ok('Coordonnées du lieu persistées à l’identique');

  const halfPair = await call(admin, `/organization/locations/${locationId}`, 'PATCH', {
    latitude: 48.9,
  });
  if (halfPair.status !== 400)
    fail(`Une latitude sans longitude a été acceptée (${halfPair.status})`);
  ok('Demi-position refusée (400) : latitude et longitude vont ensemble');

  const outOfRange = await call(admin, `/organization/locations/${locationId}`, 'PATCH', {
    latitude: 122.4,
    longitude: 37.77,
  });
  if (outOfRange.status !== 400)
    fail(`Une latitude hors bornes a été acceptée (${outOfRange.status})`);
  ok('Coordonnées hors domaine terrestre refusées (400) : lat/lng permutées');

  const cleared = await call(admin, `/organization/locations/${locationId}`, 'PATCH', {
    latitude: null,
    longitude: null,
  });
  if (cleared.status !== 200) fail(`Effacement de la position échoué (${cleared.status})`);
  const afterClear = await prisma.location.findUniqueOrThrow({ where: { id: locationId } });
  if (afterClear.latitude !== null || afterClear.longitude !== null)
    fail('La position n’a pas été effacée');
  ok('Position effaçable : le lieu redevient sans carte');

  // 3. L'audit a tracé les créations
  const auditCount = await prisma.audit_Log.count({
    where: { entity: 'Supplier', entity_id: supplierId, action: 'CREATE_SUPPLIER' },
  });
  if (auditCount !== 1) fail(`Création fournisseur non journalisée (${auditCount})`);
  ok("Création journalisée dans l'audit");

  // 4. Édition (multi-tenancy : par son org, via findFirst)
  const upd = await call(admin, `/organization/suppliers/${supplierId}`, 'PATCH', {
    contact_qualite: 'qualite@ferme.fr',
  });
  if (upd.status !== 200) fail(`Édition échouée (${upd.status})`);
  ok('Fournisseur édité');

  // 5. Archivage → disparaît de la liste par défaut, reste avec includeArchived
  const arch = await call(admin, `/organization/suppliers/${supplierId}/active`, 'PATCH', {
    active: false,
  });
  if (arch.status !== 200) fail(`Archivage échoué (${arch.status})`);

  const defaultList = await (await call(admin, '/organization/suppliers')).json();
  if (defaultList.data.some((s: { id: string }) => s.id === supplierId))
    fail('Le fournisseur archivé apparaît encore dans la liste par défaut');
  ok('Fournisseur archivé : absent de la liste par défaut');

  const archivedList = await (
    await call(admin, '/organization/suppliers?includeArchived=true')
  ).json();
  if (!archivedList.data.some((s: { id: string }) => s.id === supplierId))
    fail('Le fournisseur archivé est invisible même avec includeArchived');
  ok('Fournisseur archivé : visible avec includeArchived (pour réactivation)');

  // 6. LE POINT CLÉ : recevoir d'un fournisseur archivé est REFUSÉ (garde d'écriture)
  const recArch = await call(admin, '/logistics/receipts', 'POST', {
    id_fournisseur: supplierId,
    id_produit: '44444444-4444-4444-8444-444444444444',
    quantite_actuelle: 5,
    unite_code: 'L',
    statut_controle: 'OK',
    shipment_id: `E2E-${Date.now()}`,
  });
  if (recArch.status !== 409)
    fail(`Réception sur fournisseur archivé acceptée ou mal refusée (${recArch.status})`);
  ok('Réception refusée sur un fournisseur archivé (409) — la désactivation a un effet réel');

  // 7. Réactivation
  const react = await call(admin, `/organization/suppliers/${supplierId}/active`, 'PATCH', {
    active: true,
  });
  if (react.status !== 200) fail(`Réactivation échouée (${react.status})`);
  ok('Fournisseur réactivé');

  // Nettoyage
  // Les maillons d'audit RESTENT : les retirer amputerait au milieu la chaîne d'une organisation
  // réelle et la ferait déclarer corrompue (#291). `entity_id` n'est pas une clé étrangère, donc
  // rien n'empêche de supprimer les données métier en les laissant.
  await prisma.supplier.delete({ where: { id: supplierId } });
  await prisma.location.delete({ where: { id: locationId } });
  ok('Données e2e nettoyées');

  console.log('\n✅ CRUD référence : création, édition, archivage effectif, réactivation.\n');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`);
  await prisma.$disconnect();
  process.exit(1);
});
