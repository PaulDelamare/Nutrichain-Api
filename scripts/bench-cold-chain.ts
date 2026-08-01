import mongoose from 'mongoose';
import { randomBytes } from 'crypto';
import { prisma } from '../src/shared/configs/prismaClient.config';
import { hashGatewayKey } from '../src/shared/utils/iotGateway/iotGateway';

/**
 * NUTRICHAIN — Banc de mesure de la chaîne du froid.
 *
 * L'objectif annoncé est « alerte d'excursion thermique en moins de 30 s (p95) ». Il était écrit,
 * jamais mesuré : `docs/20_PRESENTATION_PROJET.md` le porte lui-même en ⚠️ partiel — « ne
 * chronomètre pas ; le seuil 30 s n'est pas mesuré ». Promettre un nombre sans l'avoir mesuré est
 * la première chose qu'on se fait reprocher, et « c'est rapide » n'est pas une réponse.
 *
 * Ce banc mesure ce que le capteur constate réellement, sur le VRAI chemin HTTP :
 *
 *   t0  = juste avant l'émission de la trame qui franchit le critère
 *   t1  = réponse HTTP reçue (la détection est synchrone à l'ingestion)
 *   tDb = `Alert.created_at`, l'instant où l'alerte existe en base
 *
 * L'envoi du courriel n'est PAS compté, et c'est correct : `iotAlert.service.ts` le lance en
 * `void notifyAdmins(...)`, hors du chemin de réponse. Le mesurer gonflerait le chiffre d'une
 * latence SMTP qui n'a rien à voir avec la détection.
 *
 * Tout se passe sur une organisation JETABLE, créée puis supprimée : le jeu de démonstration n'est
 * pas touché, et aucune alerte parasite ne subsiste.
 *
 * Usage : npm run bench:cold-chain -- [--iterations 10]
 */

const THRESHOLD_CELSIUS = 4;
const MIN_POINTS = 5;
const OBJECTIVE_MS = 30_000;

const argValue = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

const iterations = Number(argValue('iterations') ?? 10);
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) {
  throw new Error('--iterations attend un entier entre 1 et 100.');
}

/** Percentile par la méthode du plus proche rang, celle qui ne ment pas sur un petit échantillon. */
function percentile(sortedMs: number[], ratio: number): number {
  const rank = Math.ceil(ratio * sortedMs.length);
  return sortedMs[Math.min(rank, sortedMs.length) - 1];
}

type Fixture = {
  suffix: string;
  organizationId: string;
  equipmentId: string;
  sensorId: string;
  gatewayKey: string;
  batchId: string;
  authorId: string;
};

/**
 * Les identifiants sont tirés AVANT toute écriture, et le nettoyage travaille sur eux seuls.
 *
 * Sans ça, un échec au milieu de la création laissait une organisation orpheline en base : le
 * `try` ne couvrait pas le `seed`, donc le `finally` ne voyait aucune fixture à supprimer.
 * Constaté — un premier essai raté a laissé un `bench-froid-*` derrière lui.
 */
function newIdentity(): Fixture {
  const suffix = randomBytes(4).toString('hex');
  return {
    suffix,
    organizationId: `bench-froid-${suffix}`,
    sensorId: `BENCH-SENSOR-${suffix}`,
    gatewayKey: randomBytes(32).toString('base64url'),
    authorId: `bench-user-${suffix}`,
    equipmentId: '',
    batchId: '',
  };
}

async function seed(fixture: Fixture): Promise<Fixture> {
  const { suffix, organizationId, sensorId, gatewayKey } = fixture;

  await prisma.organization.create({
    data: { id: organizationId, name: 'Bench froid', slug: organizationId, createdAt: new Date(), metadata: '{}' },
  });
  await prisma.iotGateway.create({
    data: { organization_id: organizationId, nom: 'Passerelle de mesure', key_hash: hashGatewayKey(gatewayKey) },
  });

  const location = await prisma.location.create({
    data: { organization_id: organizationId, nom: 'Site de mesure', type: 'ENTREPOT' },
  });
  const equipment = await prisma.equipment.create({
    data: {
      organization_id: organizationId,
      nom: 'Chambre froide de mesure',
      type: 'FRIGO',
      id_lieu: location.id,
      qr_code_id: `BENCH-EQ-${suffix}`,
      sensor_id: sensorId,
      temp_seuil_max: THRESHOLD_CELSIUS,
    },
  });

  // `Batch.created_by` est une clé étrangère vers `User` : le banc a besoin de son propre auteur,
  // jetable comme le reste, plutôt que d'emprunter un compte du jeu de démonstration.
  const author = await prisma.user.create({
    data: {
      id: fixture.authorId,
      email: `bench-${suffix}@nutrichain.local`,
      name: 'Banc de mesure',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Un lot présent : la mise en quarantaine fait partie du chemin mesuré, l'exclure mesurerait
  // moins que ce que le capteur déclenche réellement.
  const product = await prisma.product.create({
    data: {
      organization_id: organizationId,
      nom: 'Produit de mesure',
      code_gtin: `9${suffix.padStart(12, '0')}`,
      categorie: 'Mesure',
      duree_conservation_defaut: 30,
      seuil_alerte_stock: 1,
      unite_reference: 'KG',
    },
  });
  const batch = await prisma.batch.create({
    data: {
      organization_id: organizationId,
      lot_number: `BENCH-${suffix}`,
      id_produit: product.id,
      quantite_actuelle: 100,
      quantite_base: 100,
      unite_code: 'KG',
      statut: 'EN_STOCK',
      id_materiel_actuel: equipment.id,
      created_by: author.id,
    },
  });

  return { ...fixture, equipmentId: equipment.id, batchId: batch.id };
}

async function cleanup(fixture: Fixture): Promise<void> {
  const { organizationId } = fixture;
  await mongoose.connection
    .db!.collection('iot_telemetries')
    .deleteMany({ 'metadata.organization_id': organizationId });
  await prisma.batch_Mouvement.deleteMany({ where: { lot: { organization_id: organizationId } } });
  await prisma.alert.deleteMany({ where: { organization_id: organizationId } });
  await prisma.batch.deleteMany({ where: { organization_id: organizationId } });
  await prisma.product.deleteMany({ where: { organization_id: organizationId } });
  await prisma.equipment.deleteMany({ where: { organization_id: organizationId } });
  await prisma.location.deleteMany({ where: { organization_id: organizationId } });
  await prisma.iotGateway.deleteMany({ where: { organization_id: organizationId } });
  // Chaîne jetable : l'organisation entière disparaît juste après, rien ne pend (#291).
  await prisma.audit_Log.deleteMany({ where: { organization_id: organizationId } });
  await prisma.audit_Checkpoint.deleteMany({ where: { organization_id: organizationId } });
  await prisma.organization.deleteMany({ where: { id: organizationId } });
  await prisma.user.deleteMany({ where: { id: fixture.authorId } });
}

/** Remet l'état d'avant excursion : sans ça, le dédoublonnage empêche toute alerte suivante. */
async function resetBetweenRuns(fixture: Fixture): Promise<void> {
  await mongoose.connection
    .db!.collection('iot_telemetries')
    .deleteMany({ 'metadata.sensor_id': fixture.sensorId });
  await prisma.alert.deleteMany({ where: { organization_id: fixture.organizationId } });
  if (fixture.batchId) await prisma.batch_Mouvement.deleteMany({ where: { id_lot: fixture.batchId } });
  await prisma.batch.update({
    where: { id: fixture.batchId },
    data: { statut: 'EN_STOCK', statut_avant_blocage: null },
  });
}

async function sendFrame(apiUrl: string, fixture: Fixture, temperature: number) {
  const response = await fetch(`${apiUrl}/api/telemetry/ping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': fixture.gatewayKey },
    body: JSON.stringify({ sensor_id: fixture.sensorId, temperature, humidity: 65, battery_level: 90 }),
  });
  if (!response.ok) {
    throw new Error(`Trame refusée (HTTP ${response.status}) — le serveur tourne-t-il ?`);
  }
  return response.json();
}

async function main() {
  const apiUrl = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI absente du .env.');
  await mongoose.connect(uri);

  console.log(`[BENCH] Chaîne du froid — ${iterations} excursions, seuil ${THRESHOLD_CELSIUS} °C`);
  console.log(`[BENCH] Objectif annoncé : alerte en moins de ${OBJECTIVE_MS / 1000} s (p95)\n`);

  const fixture = newIdentity();
  const httpLatencies: number[] = [];
  const endToEndLatencies: number[] = [];

  try {
    Object.assign(fixture, await seed(fixture));

    for (let run = 1; run <= iterations; run++) {
      await resetBetweenRuns(fixture);

      // Fenêtre vide : il faut exactement `MIN_POINTS` trames au-dessus du seuil, la dernière
      // franchit le critère. C'est elle qu'on chronomètre.
      for (let i = 0; i < MIN_POINTS - 1; i++) {
        await sendFrame(apiUrl, fixture, THRESHOLD_CELSIUS + 3);
      }

      const t0 = Date.now();
      const start = process.hrtime.bigint();
      await sendFrame(apiUrl, fixture, THRESHOLD_CELSIUS + 3);
      const httpMs = Number(process.hrtime.bigint() - start) / 1e6;

      const alert = await prisma.alert.findFirst({
        where: { organization_id: fixture.organizationId, statut: 'ACTIVE' },
        orderBy: { created_at: 'desc' },
      });
      if (!alert) {
        throw new Error(`Itération ${run} : aucune alerte créée — le critère n'a pas été franchi.`);
      }

      const endToEndMs = alert.created_at.getTime() - t0;
      httpLatencies.push(httpMs);
      endToEndLatencies.push(endToEndMs);

      const quarantined = await prisma.batch.count({
        where: { organization_id: fixture.organizationId, statut: 'BLOQUE' },
      });
      console.log(
        `  #${String(run).padStart(2)} — trame déclenchante : ${httpMs.toFixed(0)} ms | ` +
          `alerte en base : ${endToEndMs} ms | lots en quarantaine : ${quarantined}`
      );
    }
  } finally {
    await cleanup(fixture);
  }

  const sorted = [...httpLatencies].sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const max = sorted[sorted.length - 1];

  console.log(`\n— Trame déclenchante → alerte créée (${sorted.length} excursions) —`);
  console.log(`  p50 : ${p50.toFixed(0)} ms`);
  console.log(`  p95 : ${p95.toFixed(0)} ms`);
  console.log(`  max : ${max.toFixed(0)} ms`);
  if (sorted.length < 20) {
    // Sous 20 échantillons, le rang du 95e percentile est le dernier : annoncer un « p95 » qui est
    // en réalité le maximum donnerait un chiffre plus défavorable qu'il ne l'est, et surtout un
    // chiffre qui ne veut pas dire ce qu'il prétend.
    console.log(`  ⚠️  ${sorted.length} mesures : le p95 est ici le MAXIMUM. Utiliser --iterations 30.`);
  }
  console.log(
    `\n  Objectif « moins de ${OBJECTIVE_MS / 1000} s (p95) » : ` +
      `${p95 < OBJECTIVE_MS ? `TENU — ${(OBJECTIVE_MS / p95).toFixed(0)}× de marge` : 'NON TENU'}`
  );
  console.log(
    '\n  Mesure la détection, pas l’envoi du courriel : il part en `void notifyAdmins(...)`,\n' +
      '  hors du chemin de réponse. Le compter mesurerait une latence SMTP, pas la surveillance.'
  );
}

main()
  .catch((error: unknown) => {
    console.error(`\n❌ ${(error as Error).message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    if (mongoose.connection.readyState !== 0) await mongoose.connection.close();
  });
