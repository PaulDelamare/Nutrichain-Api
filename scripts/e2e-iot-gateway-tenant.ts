import { randomBytes } from 'crypto';
import { prisma } from '../src/shared/configs/prismaClient.config';
import { hashGatewayKey } from '../src/shared/utils/iotGateway/iotGateway';
import { signInAsOperator } from './helpers/e2eSession';

/**
 * NUTRICHAIN — Preuve, contre l'API RÉELLE, que la chaîne du froid n'est plus câblée sur UNE
 * organisation (issue #93).
 *
 * Avant : `machineAuth` n'avait aucune source de tenant et retombait sur `API_KEY_ORG_ID`, une
 * variable d'environnement UNIQUE. Toute trame, d'où qu'elle vienne, était donc estampillée de
 * l'organisation du `.env`. Deux conséquences, l'une bête et l'autre grave :
 *   1. une organisation créée après coup n'avait AUCUNE chaîne du froid — ingest 202, jamais
 *      d'alerte, historique vide ;
 *   2. un `sensor_id` homonyme déclenché depuis une autre organisation mettait en quarantaine des
 *      lots qui ne lui appartenaient pas — un déni de service sanitaire cross-tenant.
 *
 * Désormais l'organisation vient de la PASSERELLE qui présente la clé (`IotGateway`).
 *
 * Prérequis : `npm run dev` sur une base seedée (`npm run seed`).
 * Lancement : npm run e2e:iot-gateway
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  console.error('[E2E] API_KEY requis dans .env');
  process.exit(1);
}

const ok = (msg: string) => console.log(`  ✅ ${msg}`);
const fail = (msg: string): never => {
  throw new Error(msg);
};

const suffix = randomBytes(4).toString('hex');

/** Le capteur porte le MÊME identifiant dans les deux organisations — c'est tout l'enjeu. */
const SENSOR_ID = `E2E-GW-SENSOR-${suffix}`;

async function ping(key: string, temperature: number) {
  const res = await fetch(`${API_BASE}/api/telemetry/ping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ sensor_id: SENSOR_ID, temperature, humidity: 60, battery_level: 90 }),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as { data?: { detection?: string } } | null };
}

/**
 * Prépare un tenant : son frigo (même `sensor_id` que l'autre) et sa passerelle.
 * `orgExistante` sert à jouer la VICTIME sur l'organisation du `.env` — c'est là que l'ancien code
 * faisait atterrir toutes les trames, quelle que soit leur provenance.
 */
async function createTenant(name: string, threshold: number, existingOrg?: string) {
  const orgId = existingOrg ?? `e2e-gw-${name}-${suffix}`;
  if (!existingOrg) {
    await prisma.organization.create({
      data: { id: orgId, name: orgId, slug: orgId, createdAt: new Date() },
    });
  }

  const location = await prisma.location.create({
    data: { organization_id: orgId, nom: `Site ${name}`, type: 'STOCKAGE' },
  });

  const equipment = await prisma.equipment.create({
    data: {
      organization_id: orgId,
      nom: `Frigo ${name}`,
      type: 'FRIGO',
      id_lieu: location.id,
      temp_seuil_max: threshold,
      qr_code_id: `EQP-E2E-${name}-${suffix}`,
      sensor_id: SENSOR_ID,
    },
  });

  const key = await provisionGateway(orgId, name);

  return { orgId, key, equipmentId: equipment.id, locationId: location.id };
}

/**
 * Obtient la clé par le VRAI parcours : un administrateur de l'organisation la crée via l'API.
 * C'est la moitié qui manquait — sans elle, une organisation nouvelle n'avait aucun moyen d'obtenir
 * une passerelle, et le multi-tenant restait théorique.
 */
async function provisionGateway(orgId: string, name: string): Promise<string> {
  const admin = await signInAsOperator(prisma, {
    apiBase: API_BASE,
    apiKey: API_KEY!,
    organizationId: orgId,
    email: `e2e-gw-admin-${name}-${suffix}@nutrichain.local`,
    role: 'admin',
  });

  const res = await fetch(`${API_BASE}/api/organization/iot-gateways`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
    // Le suffixe est DANS le nom : c'est ce qui permet au nettoyage de retrouver la passerelle
    // créée par cette exécution. Sans lui, chaque passage laissait une clé vivante dans l'org réelle.
    body: JSON.stringify({ nom: `Passerelle ${name} ${suffix}` }),
  });
  const body = (await res.json()) as { data?: { cle?: string } };

  if (res.status !== 201 || !body.data?.cle) {
    fail(`Création de passerelle : attendu 201 + clé, reçu ${res.status} ${JSON.stringify(body)}`);
  }

  return body.data.cle;
}

async function cleanup(tenants: { orgId: string; equipmentId: string; locationId: string }[]) {
  // La victime est l'organisation du `.env` : on ne supprime QUE ce que la preuve a créé chez elle.
  for (const t of tenants) {
    await prisma.alert.deleteMany({ where: { id_materiel: t.equipmentId } });
    await prisma.equipment.deleteMany({ where: { id: t.equipmentId } });
    await prisma.location.deleteMany({ where: { id: t.locationId } });
  }
  // Hors de la boucle : une seule suppression pour toutes les passerelles de cette exécution.
  await prisma.iotGateway.deleteMany({ where: { nom: { contains: suffix } } });
  // Comptes créés pour le parcours (admins et opérateur de la preuve).
  const accounts = await prisma.user.findMany({
    where: { email: { contains: suffix } },
    select: { id: true },
  });
  const userIds = accounts.map((u) => u.id);
  await prisma.member.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  // L'organisation jetable a produit de l'audit (WORM) : il faut le retirer avant elle.
  const disposables = tenants.map((t) => t.orgId).filter((id) => id.startsWith('e2e-gw-'));
  await prisma.audit_Log.deleteMany({ where: { organization_id: { in: disposables } } });
  await prisma.audit_Checkpoint.deleteMany({ where: { organization_id: { in: disposables } } });
  await prisma.alert.deleteMany({ where: { organization_id: { in: disposables } } });
  await prisma.organization.deleteMany({ where: { id: { in: disposables } } });
}

async function main() {
  console.log("\n🌡️  L'organisation d'une trame vient de la passerelle, pas du .env\n");

  const orgFromEnv = process.env.API_KEY_ORG_ID;
  if (!orgFromEnv) {
    fail('API_KEY_ORG_ID requis dans .env : c’est l’organisation VICTIME de cette preuve.');
  }

  // A = l'organisation du `.env`, celle où l'ancien code faisait atterrir TOUTES les trames.
  // B = une organisation créée après coup, avec un capteur du même nom — le cas de l'issue #93.
  const a = await createTenant('victime', 4, orgFromEnv);
  const b = await createTenant('b', 4);

  try {
    // Une excursion demande ≥ 5 points au-dessus du seuil sur 15 min : une seule trame ne prouve rien.
    let lastFrame: Awaited<ReturnType<typeof ping>> | null = null;
    for (let i = 0; i < 6; i++) {
      lastFrame = await ping(b.key, 30);
      if (lastFrame.status !== 202) {
        fail(`Trame de la passerelle B : attendu 202, reçu ${lastFrame.status}`);
      }
    }
    if (lastFrame?.body?.data?.detection !== 'MONITORED') {
      fail(
        `Passerelle B : la trame devait être surveillée dans SON organisation, reçu detection=${lastFrame?.body?.data?.detection}`
      );
    }

    const alertsB = await prisma.alert.count({
      where: { organization_id: b.orgId, id_materiel: b.equipmentId, statut: 'ACTIVE' },
    });
    if (alertsB !== 1) {
      fail(`Excursion chez B : attendu 1 alerte dans SON organisation, trouvé ${alertsB}`);
    }
    ok("L'excursion de B lève une alerte chez B — une org créée après coup a enfin une chaîne du froid");

    const alertsA = await prisma.alert.count({
      where: { organization_id: a.orgId, id_materiel: a.equipmentId },
    });
    if (alertsA !== 0) {
      fail(`Une trame de B a déclenché ${alertsA} alerte(s) chez A — déni de service cross-tenant`);
    }
    ok("Zéro alerte chez la victime : le capteur homonyme de B ne bloque plus les lots d'une autre organisation");

    // La clé ne s'affiche qu'à la création : la liste ne doit jamais permettre de la retrouver.
    const operator = await signInAsOperator(prisma, {
      apiBase: API_BASE,
      apiKey: API_KEY!,
      organizationId: b.orgId,
      email: `e2e-gw-operateur-${suffix}@nutrichain.local`,
    });
    const rejection = await fetch(`${API_BASE}/api/organization/iot-gateways`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operator.token}` },
      body: JSON.stringify({ nom: 'Passerelle pirate' }),
    });
    if (rejection.status !== 403) {
      fail(`Création de passerelle par un opérateur : attendu 403, reçu ${rejection.status}`);
    }
    ok("Un opérateur ne peut pas créer de passerelle (403) — la clé vaut le droit de bloquer des lots");

    const list = await fetch(`${API_BASE}/api/organization/iot-gateways`, {
      headers: { Authorization: `Bearer ${operator.token}` },
    });
    if (list.status !== 403) {
      fail(`Liste des passerelles pour un opérateur : attendu 403, reçu ${list.status}`);
    }
    ok('La liste des passerelles est réservée à l’administration (403)');

    const unknown = await ping(`cle-jamais-enregistree-${suffix}`, 4);
    if (unknown.status !== 401) {
      fail(`Clé non enregistrée : attendu 401, reçu ${unknown.status}`);
    }
    ok('Clé non enregistrée refusée (401)');

    await prisma.iotGateway.updateMany({
      where: { key_hash: hashGatewayKey(b.key) },
      data: { revoked_at: new Date() },
    });
    const revoked = await ping(b.key, 4);
    if (revoked.status !== 401) {
      fail(`Passerelle révoquée : attendu 401, reçu ${revoked.status}`);
    }
    ok('Passerelle révoquée refusée (401) — révocable sans redéploiement');

    // Le capteur d'A est bien rattaché à un matériel : on retire le rattachement pour vérifier que
    // la réponse cesse de mentir quand aucune surveillance n'est possible.
    await prisma.equipment.update({ where: { id: a.equipmentId }, data: { sensor_id: null } });
    const orphan = await ping(a.key, 4);
    if (orphan.body?.data?.detection !== 'NO_EQUIPMENT') {
      fail(
        `Capteur sans matériel : attendu detection=NO_EQUIPMENT, reçu ${orphan.body?.data?.detection}`
      );
    }
    ok('Capteur sans matériel : 202 mais detection=NO_EQUIPMENT — la réponse ne prétend plus surveiller');

    console.log('\n🎉 Chaque passerelle alimente SON organisation, et elle seule.\n');
  } finally {
    await cleanup([a, b]);
  }
}

main()
  .catch((e) => {
    console.error(`\n❌ ${e.message}\n`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
