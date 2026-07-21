import { randomBytes, createHash } from 'crypto';
import { prisma } from '../src/shared/configs/prismaClient.config';

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

const ok = (msg: string) => console.log(`  ✅ ${msg}`);
const fail = (msg: string): never => {
  throw new Error(msg);
};

const hash = (cle: string) => createHash('sha256').update(cle, 'utf8').digest('hex');
const suffixe = randomBytes(4).toString('hex');

/** Le capteur porte le MÊME identifiant dans les deux organisations — c'est tout l'enjeu. */
const SENSOR_ID = `E2E-GW-SENSOR-${suffixe}`;

async function ping(cle: string, temperature: number) {
  const res = await fetch(`${API_BASE}/api/telemetry/ping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': cle },
    body: JSON.stringify({ sensor_id: SENSOR_ID, temperature, humidity: 60, battery_level: 90 }),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as { data?: { detection?: string } } | null };
}

/**
 * Prépare un tenant : son frigo (même `sensor_id` que l'autre) et sa passerelle.
 * `orgExistante` sert à jouer la VICTIME sur l'organisation du `.env` — c'est là que l'ancien code
 * faisait atterrir toutes les trames, quelle que soit leur provenance.
 */
async function creerTenant(nom: string, seuil: number, orgExistante?: string) {
  const orgId = orgExistante ?? `e2e-gw-${nom}-${suffixe}`;
  if (!orgExistante) {
    await prisma.organization.create({
      data: { id: orgId, name: orgId, slug: orgId, createdAt: new Date() },
    });
  }

  const lieu = await prisma.location.create({
    data: { organization_id: orgId, nom: `Site ${nom}`, type: 'STOCKAGE' },
  });

  const materiel = await prisma.equipment.create({
    data: {
      organization_id: orgId,
      nom: `Frigo ${nom}`,
      type: 'FRIGO',
      id_lieu: lieu.id,
      temp_seuil_max: seuil,
      qr_code_id: `EQP-E2E-${nom}-${suffixe}`,
      sensor_id: SENSOR_ID,
    },
  });

  const cle = `e2e-gw-cle-${nom}-${suffixe}`;
  await prisma.iotGateway.create({
    data: { organization_id: orgId, nom: `Passerelle ${nom}`, key_hash: hash(cle) },
  });

  return { orgId, cle, equipmentId: materiel.id, lieuId: lieu.id };
}

async function nettoyer(tenants: { orgId: string; equipmentId: string; lieuId: string }[]) {
  // La victime est l'organisation du `.env` : on ne supprime QUE ce que la preuve a créé chez elle.
  for (const t of tenants) {
    await prisma.alert.deleteMany({ where: { id_materiel: t.equipmentId } });
    await prisma.equipment.deleteMany({ where: { id: t.equipmentId } });
    await prisma.location.deleteMany({ where: { id: t.lieuId } });
    await prisma.iotGateway.deleteMany({ where: { nom: { contains: suffixe } } });
  }
  // L'organisation jetable a produit de l'audit (WORM) : il faut le retirer avant elle.
  const jetables = tenants.map((t) => t.orgId).filter((id) => id.startsWith('e2e-gw-'));
  await prisma.audit_Log.deleteMany({ where: { organization_id: { in: jetables } } });
  await prisma.audit_Checkpoint.deleteMany({ where: { organization_id: { in: jetables } } });
  await prisma.alert.deleteMany({ where: { organization_id: { in: jetables } } });
  await prisma.organization.deleteMany({ where: { id: { in: jetables } } });
}

async function main() {
  console.log("\n🌡️  L'organisation d'une trame vient de la passerelle, pas du .env\n");

  const orgDuEnv = process.env.API_KEY_ORG_ID;
  if (!orgDuEnv) {
    fail('API_KEY_ORG_ID requis dans .env : c’est l’organisation VICTIME de cette preuve.');
  }

  // A = l'organisation du `.env`, celle où l'ancien code faisait atterrir TOUTES les trames.
  // B = une organisation créée après coup, avec un capteur du même nom — le cas de l'issue #93.
  const a = await creerTenant('victime', 4, orgDuEnv);
  const b = await creerTenant('b', 4);

  try {
    // Une excursion demande ≥ 5 points au-dessus du seuil sur 15 min : une seule trame ne prouve rien.
    let derniereTrame: Awaited<ReturnType<typeof ping>> | null = null;
    for (let i = 0; i < 6; i++) {
      derniereTrame = await ping(b.cle, 30);
      if (derniereTrame.status !== 202) {
        fail(`Trame de la passerelle B : attendu 202, reçu ${derniereTrame.status}`);
      }
    }
    if (derniereTrame?.body?.data?.detection !== 'MONITORED') {
      fail(
        `Passerelle B : la trame devait être surveillée dans SON organisation, reçu detection=${derniereTrame?.body?.data?.detection}`
      );
    }

    const alertesB = await prisma.alert.count({
      where: { organization_id: b.orgId, id_materiel: b.equipmentId, statut: 'ACTIVE' },
    });
    if (alertesB !== 1) {
      fail(`Excursion chez B : attendu 1 alerte dans SON organisation, trouvé ${alertesB}`);
    }
    ok("L'excursion de B lève une alerte chez B — une org créée après coup a enfin une chaîne du froid");

    const alertesA = await prisma.alert.count({
      where: { organization_id: a.orgId, id_materiel: a.equipmentId },
    });
    if (alertesA !== 0) {
      fail(`Une trame de B a déclenché ${alertesA} alerte(s) chez A — déni de service cross-tenant`);
    }
    ok("Zéro alerte chez la victime : le capteur homonyme de B ne bloque plus les lots d'une autre organisation");

    const inconnue = await ping(`cle-jamais-enregistree-${suffixe}`, 4);
    if (inconnue.status !== 401) {
      fail(`Clé non enregistrée : attendu 401, reçu ${inconnue.status}`);
    }
    ok('Clé non enregistrée refusée (401)');

    await prisma.iotGateway.updateMany({
      where: { key_hash: hash(b.cle) },
      data: { revoked_at: new Date() },
    });
    const revoquee = await ping(b.cle, 4);
    if (revoquee.status !== 401) {
      fail(`Passerelle révoquée : attendu 401, reçu ${revoquee.status}`);
    }
    ok('Passerelle révoquée refusée (401) — révocable sans redéploiement');

    // Le capteur d'A est bien rattaché à un matériel : on retire le rattachement pour vérifier que
    // la réponse cesse de mentir quand aucune surveillance n'est possible.
    await prisma.equipment.update({ where: { id: a.equipmentId }, data: { sensor_id: null } });
    const orpheline = await ping(a.cle, 4);
    if (orpheline.body?.data?.detection !== 'NO_EQUIPMENT') {
      fail(
        `Capteur sans matériel : attendu detection=NO_EQUIPMENT, reçu ${orpheline.body?.data?.detection}`
      );
    }
    ok('Capteur sans matériel : 202 mais detection=NO_EQUIPMENT — la réponse ne prétend plus surveiller');

    console.log('\n🎉 Chaque passerelle alimente SON organisation, et elle seule.\n');
  } finally {
    await nettoyer([a, b]);
  }
}

main()
  .catch((e) => {
    console.error(`\n❌ ${e.message}\n`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
