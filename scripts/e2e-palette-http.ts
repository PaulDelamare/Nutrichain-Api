/**
 * E2E — la palette par HTTP RÉEL, et l'excursion thermique qui la bloque en entier.
 *
 * Ce scénario existe parce que les autres ne prouvent pas ce qui compte le plus :
 *
 * 1. `e2e:logistic-unit` appelle les SERVICES directement, et le test de route mocke le
 *    contrôleur. Le câblage HTTP complet — session réelle, validation montée, garde de rôle,
 *    contrôleur, service — n'était donc prouvé par rien. C'est exactement la classe de défaut
 *    « fonctionnalité terminée et testée, et la route renvoie 401 ».
 * 2. Le gain annoncé du modèle — « une excursion bloque toute la palette » — n'était qu'une
 *    déduction. Ici on déclenche une VRAIE excursion sur le frigo où la palette est rangée, et on
 *    exige que TOUS ses lots passent en quarantaine.
 *
 * Pré-requis : Postgres + Mongo + migrations + seed + **serveur en marche** (comme les autres
 * scénarios HTTP de la CI). Lancement : npm run e2e:palette-http
 */
import mongoose from 'mongoose';
import { prisma } from '../src/shared/configs/prismaClient.config';
import { connectMongoDB, disconnectMongoDB } from '../src/shared/configs/mongoClient.config';
import { TelemetryModel } from '../src/modules/iot/models/telemetry.model';
import { iotAlertService } from '../src/modules/iot/services/iotAlert.service';
import { signInAsOperator } from './helpers/e2eSession';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const API_KEY = process.env.API_KEY ?? '';
const ORG_ID = process.env.API_KEY_ORG_ID;

const failures: string[] = [];
let token = '';

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}`);
    failures.push(label);
  }
}

const call = (path: string, method = 'GET', body?: unknown) =>
  fetch(`${API_URL}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

/** Déclenche une excursion réelle, dans la même session Mongo qu'en production. */
async function ingestPing(sensorId: string, temperature: number, minutesAgo = 0): Promise<void> {
  const ts = new Date(Date.now() - minutesAgo * 60_000);
  const session = await mongoose.startSession();
  try {
    await TelemetryModel.create(
      [
        {
          metadata: { sensor_id: sensorId, organization_id: ORG_ID! },
          timestamp: ts,
          temperature,
          humidity: 50,
          battery_level: 80,
        },
      ],
      { session }
    );
    await iotAlertService.checkAndAlert({
      sensorId,
      organizationId: ORG_ID!,
      currentTemp: temperature,
      timestamp: ts,
      mongoSession: session,
    });
  } finally {
    await session.endSession();
  }
}

async function main(): Promise<void> {
  if (!ORG_ID) throw new Error('API_KEY_ORG_ID manquant dans .env');
  await connectMongoDB();

  const stamp = Date.now().toString().slice(-9);
  const sensorId = `E2E-PAL-SENSOR-${stamp}`;
  const unit = await prisma.unit.findFirstOrThrow();
  const product = await prisma.product.findFirstOrThrow({ where: { organization_id: ORG_ID } });
  const location = await prisma.location.findFirstOrThrow({ where: { organization_id: ORG_ID } });

  // Frigo surveillé, dédié au scénario : on ne déclenche pas d'excursion sur un matériel partagé.
  const fridge = await prisma.equipment.create({
    data: {
      organization_id: ORG_ID,
      nom: `E2E-PAL-FRIGO-${stamp}`,
      type: 'FRIGO',
      id_lieu: location.id,
      qr_code_id: `E2E-PAL-QR-${stamp}`,
      sensor_id: sensorId,
      temp_seuil_max: 4,
    },
  });

  const session = await signInAsOperator(prisma, {
    apiBase: API_URL,
    apiKey: API_KEY,
    organizationId: ORG_ID,
  });
  token = session.token;

  const makeBatch = (suffix: string) =>
    prisma.batch.create({
      data: {
        organization_id: ORG_ID!,
        id_produit: product.id,
        lot_number: `E2E-PAL-${stamp}-${suffix}`,
        quantite_actuelle: 60,
        quantite_base: 60,
        unite_code: unit.code,
        statut: 'EN_STOCK',
        created_by: session.userId,
      },
    });

  const lotA = await makeBatch('A');
  const lotB = await makeBatch('B');
  const createdBatches = [lotA.id, lotB.id];
  let palletId = '';

  try {
    console.log('\n[1] Constituer la palette — par HTTP, avec une vraie session opérateur');
    const created = await call('/logistics/logistic-units', 'POST', {
      items: [
        { id_lot: lotA.id, quantite: 30 },
        { id_lot: lotB.id, quantite: 20 },
      ],
    });
    assert(created.status === 201, `POST /logistics/logistic-units → 201 (reçu ${created.status})`);
    const createdBody = (await created.json()) as { data?: { id: string; sscc: string } };
    palletId = createdBody.data?.id ?? '';
    const sscc = createdBody.data?.sscc ?? '';
    assert(/^\d{18}$/.test(sscc), `le SSCC rendu fait 18 chiffres (${sscc})`);

    console.log('\n[2] Ranger la palette — LA route que rien ne prouvait');
    const ranged = await call(`/logistics/logistic-units/${palletId}/location`, 'PATCH', {
      id_materiel: fridge.id,
    });
    assert(ranged.status === 200, `PATCH .../location → 200 (reçu ${ranged.status})`);
    const rangedBody = (await ranged.json()) as { data?: { lots_deplaces: number } };
    assert(rangedBody.data?.lots_deplaces === 2, 'la réponse annonce 2 lots déplacés');

    const positions = await prisma.batch.findMany({
      where: { id: { in: createdBatches } },
      select: { id_materiel_actuel: true },
    });
    assert(
      positions.every((p) => p.id_materiel_actuel === fridge.id),
      'les deux lots portent la position du frigo, en base'
    );

    console.log('\n[3] Le scan HTTP rend le contenu de la palette');
    const scanned = await call(`/logistics/logistic-units/by-sscc/${sscc}`);
    assert(scanned.status === 200, `GET .../by-sscc → 200 (reçu ${scanned.status})`);
    const scanBody = (await scanned.json()) as { data?: { lots: unknown[] } };
    assert(scanBody.data?.lots.length === 2, 'le scan rend les deux lots');

    console.log('\n[4] Sans session, la route de rangement refuse (401)');
    const anonyme = await fetch(`${API_URL}/api/logistics/logistic-units/${palletId}/location`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ id_materiel: fridge.id }),
    });
    assert(anonyme.status === 401, `PATCH sans session → 401 (reçu ${anonyme.status})`);

    console.log('\n[5] Validation réellement montée : sans emplacement, 400');
    const sansMateriel = await call(`/logistics/logistic-units/${palletId}/location`, 'PATCH', {});
    assert(sansMateriel.status === 400, `PATCH sans id_materiel → 400 (reçu ${sansMateriel.status})`);

    console.log('\n[6] LE GAIN DU MODÈLE — une excursion bloque TOUTE la palette');
    await TelemetryModel.deleteMany({ 'metadata.sensor_id': sensorId });
    // La détection exige au moins 5 points dans la fenêtre, dont 80 % au-dessus du seuil
    // (`excursionDetection.service`) : deux ou trois relevés ne déclenchent RIEN, à dessein — on
    // n'immobilise pas un stock sur un pic isolé de capteur. Six points montants, comme une vraie
    // panne de groupe froid.
    for (const [minutesAgo, temp] of [
      [10, 7],
      [8, 8],
      [6, 9],
      [4, 10],
      [2, 11],
      [0, 12],
    ] as const) {
      await ingestPing(sensorId, temp, minutesAgo);
    }

    const apresExcursion = await prisma.batch.findMany({
      where: { id: { in: createdBatches } },
      select: { lot_number: true, statut: true, statut_avant_blocage: true },
    });
    assert(
      apresExcursion.every((b) => b.statut === 'BLOQUE'),
      `les DEUX lots de la palette sont en quarantaine (${apresExcursion.map((b) => b.statut).join(', ')})`
    );
    assert(
      apresExcursion.every((b) => b.statut_avant_blocage === 'EN_STOCK'),
      'leur statut d’origine est mémorisé pour la levée'
    );
    assert(
      apresExcursion.length === 2,
      'aucun lot de la palette n’a échappé au blocage'
    );

    console.log('\n[7] Le scan signale désormais la palette comme non saine');
    const scanApres = await call(`/logistics/logistic-units/by-sscc/${sscc}`);
    const scanApresBody = (await scanApres.json()) as {
      data?: { lots: { statut: string }[] };
    };
    assert(
      scanApresBody.data?.lots.every((l) => l.statut === 'BLOQUE') === true,
      'le scan montre les deux lots bloqués — l’opérateur le voit sur le quai'
    );
  } finally {
    // Cleanup. On ne touche PAS à Audit_Log : la chaîne est chaînée par hash, en retirer une ligne
    // la romprait pour toute l'organisation.
    await prisma.batch_Mouvement.deleteMany({ where: { id_lot: { in: createdBatches } } });
    if (palletId) {
      await prisma.logistic_Unit_Content.deleteMany({ where: { id_unite_logistique: palletId } });
      await prisma.ePCIS_Event.deleteMany({ where: { related_id: palletId } });
      await prisma.logistic_Unit.deleteMany({ where: { id: palletId } });
    }
    await prisma.batch.deleteMany({ where: { id: { in: createdBatches } } });
    await prisma.alert.deleteMany({ where: { id_materiel: fridge.id } });
    await prisma.equipment.deleteMany({ where: { id: fridge.id } });
    await TelemetryModel.deleteMany({ 'metadata.sensor_id': sensorId });
    await disconnectMongoDB();
    await prisma.$disconnect();
  }

  if (failures.length > 0) {
    console.error(`\n[E2E] ❌ ${failures.length} assertion(s) en échec.`);
    process.exit(1);
  }
  console.log('\n[E2E] ✅ toutes les assertions passent.');
}

main().catch(async (error) => {
  console.error('[E2E] erreur inattendue', error);
  process.exit(1);
});
