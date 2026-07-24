import { prisma } from '../src/shared/configs/prismaClient.config';
import { signInAsOperator } from './helpers/e2eSession';

/**
 * NUTRICHAIN — Preuve, contre l'API RÉELLE, que la clé API n'autorise plus aucune action.
 *
 * Le contexte, en une phrase : cette clé était commitée dans un dépôt PUBLIC, et elle est de toute
 * façon compilée dans le bundle de l'application mobile (`EXPO_PUBLIC_API_KEY`) — donc extractible
 * par quiconque l'installe. Elle N'EST PAS un secret. Tant qu'elle ouvrait des routes métier, un
 * inconnu pouvait créer des réceptions, les signer au nom du patron, et lire l'annuaire nominatif
 * des salariés.
 *
 * La règle tenue désormais : une clé identifie une APPLICATION ; seule une session AUTORISE une
 * action. Les capteurs font exception : ils déposent des mesures, sans identité ni décision.
 *
 * Prérequis : `npm run dev` sur une base seedée (`npm run seed`).
 * Lancement : npm run e2e:api-key
 */

const API_URL = process.env.API_URL || process.env.API_BASE || 'http://localhost:3000';
/** La clé PUBLIQUE, celle de l'application mobile : elle ne doit rien ouvrir d'autre que la connexion. */
const API_KEY = process.env.API_KEY;
/** La clé des CAPTEURS : un vrai secret, qui ne quitte pas le serveur. */
const IOT_API_KEY = process.env.IOT_API_KEY;
const ORG_ID = process.env.API_KEY_ORG_ID;

if (!API_KEY || !IOT_API_KEY || !ORG_ID) {
  console.error('❌ API_KEY, IOT_API_KEY et API_KEY_ORG_ID doivent être définis dans .env');
  process.exit(1);
}

const ok = (msg: string) => console.log(`  ✅ ${msg}`);
const fail = (msg: string): never => {
  throw new Error(msg);
};

const RECEIPT = {
  id_fournisseur: '11111111-1111-4111-8111-111111111111',
  id_produit: '44444444-4444-4444-8444-444444444444',
  quantite_actuelle: 10,
  unite_code: 'L',
  statut_controle: 'OK',
};

async function post(path: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
  const key = { 'x-api-key': API_KEY! };

  console.log('\n🔐 La clé API seule n’ouvre plus aucune route métier\n');

  const write = await post('/api/logistics/receipts', key, {
    ...RECEIPT,
    shipment_id: `E2E-CLE-${Date.now()}`,
  });
  if (write.status !== 401) {
    fail(`Réception avec la seule clé : attendu 401, reçu ${write.status}`);
  }
  ok('Réception refusée (401) — écrire exige un utilisateur authentifié');

  // La garde d'appartenance ne suffisait pas : elle empêche de désigner un ÉTRANGER, pas d'usurper
  // un collègue légitime. Avec une clé publique, « signé du patron » était à la portée de tous.
  const owner = await prisma.user.findUnique({ where: { email: 'admin@nutrichain.local' } });
  if (!owner) {
    // Sans ce garde, `actorUserId: undefined` disparaît du JSON : le test dégénérerait en doublon
    // du précédent — et afficherait ✅. Une preuve doit échouer bruyamment, jamais s'auto-satisfaire.
    fail('Compte propriétaire introuvable : lance `npm run seed` avant cette preuve.');
  }

  const impersonation = await post('/api/logistics/receipts', key, {
    ...RECEIPT,
    shipment_id: `E2E-USURP-${Date.now()}`,
    actorUserId: owner.id,
  });
  if (impersonation.status !== 401) {
    fail(`Réception « signée du patron » : attendu 401, reçu ${impersonation.status}`);
  }
  ok('Réception au nom du propriétaire refusée (401) — même acteur légitime déclaré');

  const directory = await fetch(`${API_URL}/api/organization/members`, { headers: key });
  if (directory.status !== 401) {
    fail(`Annuaire des salariés : attendu 401, reçu ${directory.status}`);
  }
  ok('Annuaire nominatif des salariés refusé (401) — donnée personnelle, enjeu RGPD');

  const catalogue = await fetch(`${API_URL}/api/connectors/exports/events`, { headers: key });
  if (catalogue.status !== 401) {
    fail(`Export EPCIS : attendu 401, reçu ${catalogue.status}`);
  }
  ok('Export des événements EPCIS refusé (401)');

  // Le pire cas, longtemps ignoré : une trame de télémétrie ne décrit pas, elle DÉCIDE. Elle met
  // en quarantaine tous les lots du matériel visé et lève une alerte PANIC. Avec la clé du mobile,
  // un inconnu arrêtait la production. Les capteurs ont désormais leur propre secret (IOT_API_KEY).
  const fakeFrame = await post('/api/telemetry/ping', key, {
    sensor_id: 'E2E-SENSOR-1',
    temperature: 40,
    humidity: 60,
    battery_level: 88,
  });
  if (fakeFrame.status !== 401) {
    fail(`Trame capteur avec la clé de l'application : attendu 401, reçu ${fakeFrame.status}`);
  }
  ok("Trame capteur refusée (401) — la clé de l'app ne met plus la production en quarantaine");

  console.log('\n✅ Ce qui doit continuer de marcher\n');

  const session = await signInAsOperator(prisma, {
    apiBase: API_URL,
    apiKey: API_KEY!,
    organizationId: ORG_ID!,
  });
  ok('Connexion d’un opérateur — la clé sert bien à /api/auth/*');

  const legitimate = await post(
    '/api/logistics/receipts',
    { Authorization: `Bearer ${session.token}` },
    { ...RECEIPT, shipment_id: `E2E-OK-${Date.now()}` }
  );
  if (legitimate.status !== 201) {
    fail(`Réception d'un opérateur connecté : attendu 201, reçu ${legitimate.status}`);
  }
  ok('Réception d’un opérateur connecté acceptée (201)');

  const sensor = await post(
    '/api/telemetry/ping',
    { 'x-api-key': IOT_API_KEY! },
    { sensor_id: 'E2E-SENSOR-1', temperature: 4.2, humidity: 60, battery_level: 88 }
  );
  if (sensor.status >= 400) {
    fail(`Ingestion capteur : attendu un succès, reçu ${sensor.status}`);
  }
  ok(`Ingestion d’un capteur acceptée (${sensor.status}) — une machine dépose des mesures`);

  console.log('\n🎉 La clé identifie une application. Seule une session autorise une action.\n');
}

main()
  .catch((e) => {
    console.error(`\n❌ ${e.message}\n`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
