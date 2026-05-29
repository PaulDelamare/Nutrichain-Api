/**
 * E2E — résolution d'alerte (PATCH /api/alerts/:id/resolve).
 *
 * Valide la vraie chaîne Postgres + transaction Serializable + audit WORM, puis
 * confirme que la résolution **débloque effectivement** la dédup IoT (preuve déterministe
 * exigée par le multi-review v1 du plan).
 *
 * Pré-requis :
 * - DB Postgres up + migrations + seed
 * - Mongo up (pour le re-trigger IoT)
 * - .env contient API_KEY_ORG_ID
 *
 * Lancement : `npm run e2e:alert-resolve`
 *
 * Scénarios :
 *  1. Setup : Equipment + sensor_id + threshold + 1 Alert TEMP_EXCURSION ACTIVE pré-créée
 *  2. Happy path résolution → statut RESOLVED, audit créé, oldValue/newValue correctes
 *  3. Idempotent → 2e appel ne crée PAS de 2e ligne audit
 *  4. Re-déclencher la dédup IoT → nouveau ping → nouvelle Alert ACTIVE créée
 *  5. PRODUCT_RECALL : Batch ALERTE + Alert PRODUCT_RECALL résolue
 *     → Alert RESOLVED, Batch RESTE ALERTE (preuve du découplage volontaire)
 *  6. Cleanup
 */
import { prisma } from '../src/shared/configs/prismaClient.config';
import { connectMongoDB, disconnectMongoDB } from '../src/shared/configs/mongoClient.config';
import { TelemetryModel } from '../src/modules/iot/models/telemetry.model';
import {
  iotAlertService,
  _clearThresholdCacheForTests,
} from '../src/modules/iot/services/iotAlert.service';
import { alertService } from '../src/modules/alerts/services/alert.service';

const ORG_ID = process.env.API_KEY_ORG_ID;
if (!ORG_ID) {
  console.error('[E2E] API_KEY_ORG_ID requis dans .env');
  process.exit(1);
}

const failures: string[] = [];
function assert(condition: boolean, label: string): void {
  if (!condition) {
    failures.push(label);
    console.error(`  ❌ ${label}`);
  } else {
    console.log(`  ✅ ${label}`);
  }
}

interface Fixtures {
  equipmentId: string;
  sensorId: string;
  locationId: string;
  productId: string;
  uniteId: string;
  resolverUserId: string;
  initialAlertId: string;
  recallBatchId?: string;
  recallAlertId?: string;
}

async function setup(): Promise<Fixtures> {
  console.log('\n[E2E] Setup...');
  const stamp = Date.now();
  const sensorId = `E2E-RESOLVE-SENSOR-${stamp}`;

  let location = await prisma.location.findFirst({ where: { organization_id: ORG_ID! } });
  if (!location) {
    location = await prisma.location.create({
      data: { organization_id: ORG_ID!, nom: `E2E-Resolve-Loc-${stamp}`, type: 'WAREHOUSE' },
    });
  }

  const equipment = await prisma.equipment.create({
    data: {
      organization_id: ORG_ID!,
      nom: `E2E-Resolve-Frigo-${stamp}`,
      type: 'FRIGO',
      id_lieu: location.id,
      sensor_id: sensorId,
      temp_seuil_max: 4,
    },
  });

  const adminMember = await prisma.member.findFirst({
    where: { organizationId: ORG_ID!, role: { in: ['owner', 'admin'] } },
    include: { user: true },
  });
  if (!adminMember) {
    throw new Error('Pas de member owner/admin seedé pour cette org.');
  }

  let unite = await prisma.unite_Mesure.findFirst();
  if (!unite) {
    unite = await prisma.unite_Mesure.create({ data: { code: 'KG', nom: 'Kilogramme' } });
  }
  let product = await prisma.produit.findFirst({ where: { organization_id: ORG_ID! } });
  if (!product) {
    product = await prisma.produit.create({
      data: {
        organization_id: ORG_ID!,
        nom: `E2E-Produit-${stamp}`,
        unite_code: unite.code,
        type_produit: 'MATIERE_PREMIERE',
      },
    });
  }

  const initialAlert = await prisma.alert.create({
    data: {
      organization_id: ORG_ID!,
      type: 'TEMP_EXCURSION',
      niveau_gravite: 'PANIC',
      message: `E2E pre-resolve test — excursion thermique sur ${sensorId}`,
      id_materiel: equipment.id,
      related_entity: 'Equipment',
      related_id: equipment.id,
      statut: 'ACTIVE',
    },
  });

  console.log(
    `  → sensor=${sensorId}, equipment=${equipment.id}, alertId=${initialAlert.id}, resolver=${adminMember.user.email}`
  );

  return {
    equipmentId: equipment.id,
    sensorId,
    locationId: location.id,
    productId: product.id,
    uniteId: unite.code,
    resolverUserId: adminMember.user.id,
    initialAlertId: initialAlert.id,
  };
}

async function cleanup(f: Fixtures): Promise<void> {
  console.log('\n[E2E] Cleanup...');
  await prisma.audit_Log.deleteMany({
    where: { organization_id: ORG_ID!, action: 'ALERT_RESOLVED' },
  });
  await prisma.audit_Log.deleteMany({
    where: { organization_id: ORG_ID!, action: 'TEMP_EXCURSION_DETECTED' },
  });
  await prisma.alert.deleteMany({ where: { id_materiel: f.equipmentId } });
  if (f.recallAlertId) {
    await prisma.alert.deleteMany({ where: { id: f.recallAlertId } });
  }
  if (f.recallBatchId) {
    await prisma.batch.deleteMany({ where: { id: f.recallBatchId } });
  }
  await prisma.equipment.delete({ where: { id: f.equipmentId } });
  await TelemetryModel.deleteMany({ 'metadata.sensor_id': f.sensorId });
  console.log('  → fixtures supprimées');
}

async function main(): Promise<void> {
  console.log(`[E2E] Alert resolve — org ${ORG_ID}`);
  await connectMongoDB();

  let fixtures: Fixtures | null = null;
  try {
    fixtures = await setup();
    _clearThresholdCacheForTests();
    await TelemetryModel.deleteMany({ 'metadata.sensor_id': fixtures.sensorId });

    // ===== Scénario 2 : Happy path résolution =====
    console.log('\nScénario 2 — Happy path : Alert ACTIVE → RESOLVED + audit créé');
    const initialAlert = await prisma.alert.findUniqueOrThrow({
      where: { id: fixtures.initialAlertId },
    });
    const resolveResult = await alertService.resolveAlert({
      alert: initialAlert,
      userId: fixtures.resolverUserId,
      note: 'Nettoyage capteur effectué par technicien NORD',
    });
    assert(resolveResult.alreadyResolved === false, 'alreadyResolved === false');
    assert(resolveResult.alert.statut === 'RESOLVED', `statut=RESOLVED (reçu ${resolveResult.alert.statut})`);
    assert(
      resolveResult.alert.resolved_by === fixtures.resolverUserId,
      'resolved_by correctement set sur userId session'
    );
    assert(resolveResult.alert.resolved_at instanceof Date, 'resolved_at est une Date');

    const auditRows = await prisma.audit_Log.findMany({
      where: { organization_id: ORG_ID!, action: 'ALERT_RESOLVED', entity_id: fixtures.initialAlertId },
    });
    assert(auditRows.length === 1, `1 ligne audit ALERT_RESOLVED (reçu ${auditRows.length})`);
    const audit = auditRows[0];
    const oldValue = audit.ancienne_valeur as { statut?: string };
    const newValue = audit.nouvelle_valeur as { statut?: string; note?: string | null };
    assert(oldValue?.statut === 'ACTIVE', `ancienne_valeur.statut === 'ACTIVE' (reçu ${oldValue?.statut})`);
    assert(newValue?.statut === 'RESOLVED', `nouvelle_valeur.statut === 'RESOLVED'`);
    assert(
      newValue?.note === 'Nettoyage capteur effectué par technicien NORD',
      'nouvelle_valeur.note matche'
    );

    // ===== Scénario 3 : Idempotent — pas de 2e ligne audit =====
    console.log('\nScénario 3 — Idempotent : 2e PATCH ne crée PAS de 2e audit');
    const reResolveResult = await alertService.resolveAlert({
      alert: resolveResult.alert,
      userId: fixtures.resolverUserId,
    });
    assert(reResolveResult.alreadyResolved === true, 'alreadyResolved === true (replay)');
    const auditRowsAfterReplay = await prisma.audit_Log.count({
      where: { organization_id: ORG_ID!, action: 'ALERT_RESOLVED', entity_id: fixtures.initialAlertId },
    });
    assert(
      auditRowsAfterReplay === 1,
      `Toujours 1 ligne audit après replay (reçu ${auditRowsAfterReplay})`
    );

    // ===== Scénario 4 : Re-déclencher la dédup IoT =====
    console.log('\nScénario 4 — Dédup débloquée : nouveau ping IoT → nouvelle Alert ACTIVE');
    // Insérer ≥ 5 points au-dessus du seuil dans la fenêtre 15min (préparer le terrain
    // pour que detectExcursion confirme une excursion sur le 6e ping).
    for (let i = 9; i >= 0; i--) {
      await TelemetryModel.create({
        metadata: { sensor_id: fixtures.sensorId, organization_id: ORG_ID! },
        timestamp: new Date(Date.now() - i * 60_000),
        temperature: 8,
        humidity: 50,
        battery_level: 80,
      });
    }
    _clearThresholdCacheForTests();
    await iotAlertService.checkAndAlert({
      sensorId: fixtures.sensorId,
      organizationId: ORG_ID!,
      currentTemp: 8,
      timestamp: new Date(),
    });
    // Assert : il existe AU MOINS une Alert ACTIVE postérieure à la résolution,
    // d'id différent de l'Alert initiale. C'est la preuve que la dédup est débloquée
    // sans coupler le test à un nombre exact (résilient si la logique IoT évolue).
    const activeAlertsAfter = await prisma.alert.findMany({
      where: { id_materiel: fixtures.equipmentId, type: 'TEMP_EXCURSION', statut: 'ACTIVE' },
      select: { id: true },
    });
    const newActiveAlerts = activeAlertsAfter.filter((a) => a.id !== fixtures.initialAlertId);
    assert(
      newActiveAlerts.length >= 1,
      `Au moins 1 NOUVELLE Alert ACTIVE (id ≠ initialAlertId) créée (reçu ${newActiveAlerts.length})`
    );

    // ===== Scénario 5 : PRODUCT_RECALL — Alert RESOLVED, Batch RESTE ALERTE =====
    console.log('\nScénario 5 — PRODUCT_RECALL : Alert résolue, Batch source garde statut ALERTE');
    const recallBatch = await prisma.batch.create({
      data: {
        organization_id: ORG_ID!,
        id_produit: fixtures.productId,
        unite_code: fixtures.uniteId,
        quantite_initiale: 100,
        quantite_restante: 100,
        statut: 'ALERTE',
      },
    });
    fixtures.recallBatchId = recallBatch.id;
    const recallAlert = await prisma.alert.create({
      data: {
        organization_id: ORG_ID!,
        type: 'PRODUCT_RECALL',
        niveau_gravite: 'CRITIQUE',
        message: `E2E PRODUCT_RECALL test — batch ${recallBatch.id}`,
        related_entity: 'Batch',
        related_id: recallBatch.id,
        statut: 'ACTIVE',
      },
    });
    fixtures.recallAlertId = recallAlert.id;

    const recallResolveResult = await alertService.resolveAlert({
      alert: recallAlert,
      userId: fixtures.resolverUserId,
      note: 'Cellule qualité a validé la non-conformité — rappel en cours via workflow Recall séparé',
    });
    assert(recallResolveResult.alert.statut === 'RESOLVED', 'Alert PRODUCT_RECALL statut=RESOLVED');
    const batchAfterRecallResolve = await prisma.batch.findUniqueOrThrow({
      where: { id: recallBatch.id },
    });
    assert(
      batchAfterRecallResolve.statut === 'ALERTE',
      `Batch source RESTE en ALERTE (preuve du découplage : reçu ${batchAfterRecallResolve.statut})`
    );
  } catch (err) {
    console.error('\n[E2E] Erreur fatale:', err);
    failures.push(`Exception: ${(err as Error).message}`);
  } finally {
    if (fixtures) {
      try {
        await cleanup(fixtures);
      } catch (e) {
        console.error('[E2E] Cleanup error:', e);
      }
    }
    await prisma.$disconnect();
    await disconnectMongoDB();
    if (failures.length > 0) {
      console.error(`\n❌ ${failures.length} échec(s):`);
      failures.forEach((f) => console.error(`   - ${f}`));
      process.exitCode = 1;
    } else {
      console.log('\n✅ Tous les scénarios E2E alert-resolve sont passés.');
    }
  }
}

main();
