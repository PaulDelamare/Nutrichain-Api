/**
 * E2E — vérification d'intégrité de la chaîne d'audit WORM (Objectif SMART n°7).
 *
 * Crée une org éphémère + 3 lignes Audit_Log via `auditService.logAction` réelles,
 * valide la chaîne, persiste un checkpoint, puis exécute 2 attaques :
 * - tampering signature (UPDATE raw SQL d'une nouvelle_valeur)
 * - truncation (DELETE raw SQL d'une ligne de fin)
 * Et confirme que verifyChain détecte les 2 cas.
 *
 * Cleanup important : Audit_Log a `onDelete: Restrict` sur Organization. On supprime
 * donc d'abord les Audit_Log, puis Audit_Checkpoint, puis l'org éphémère. Pure
 * opération de test, jamais utilisée en prod.
 *
 * Lancement : `npm run e2e:audit-verify`.
 */
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/shared/configs/prismaClient.config';
import { auditService } from '../src/shared/utils/audit/audit.service';
import { auditVerifyService } from '../src/modules/auditIntegrity/services/auditVerify.service';

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
  ephemeralOrgId: string;
  initialAuditIds: number[];
}

async function setup(): Promise<Fixtures> {
  console.log('\n[E2E] Setup...');
  const stamp = Date.now();
  const orgId = crypto.randomUUID();
  await prisma.organization.create({
    data: {
      id: orgId,
      name: `E2E-AuditVerify-${stamp}`,
      slug: `e2e-audit-verify-${stamp}`,
      createdAt: new Date(),
      metadata: '{}',
    },
  });

  const ids: number[] = [];
  for (let i = 1; i <= 3; i++) {
    const log = await auditService.logAction({
      organizationId: orgId,
      action: 'TEST_E2E',
      entity: 'E2E',
      entityId: `entity-${i}`,
      newValue: { i },
    });
    ids.push(log.id);
  }
  console.log(`  → org=${orgId} audits=${ids.join(',')}`);
  return { ephemeralOrgId: orgId, initialAuditIds: ids };
}

async function cleanup(f: Fixtures): Promise<void> {
  console.log('\n[E2E] Cleanup...');
  // Ordre critique : Audit_Log onDelete:Restrict → delete logs avant org.
  await prisma.$executeRaw(
    Prisma.sql`DELETE FROM "Audit_Log" WHERE organization_id = ${f.ephemeralOrgId}`
  );
  await prisma.audit_Checkpoint.deleteMany({ where: { organization_id: f.ephemeralOrgId } });
  await prisma.organization.delete({ where: { id: f.ephemeralOrgId } });
  console.log('  → fixtures supprimées');
}

async function main(): Promise<void> {
  console.log('[E2E] Audit chain verify');

  let fixtures: Fixtures | null = null;
  try {
    fixtures = await setup();

    // Scénario 2 : chaîne valide
    console.log('\nScénario 2 — Chaîne valide → valid:true');
    let result = await auditVerifyService.verifyChain({ organizationId: fixtures.ephemeralOrgId });
    assert(result.valid === true, `valid:true (reçu ${result.valid})`);
    assert(result.rowsChecked === 3, `rowsChecked === 3 (reçu ${result.rowsChecked})`);

    // Scénario 3 : checkpoint persisté
    console.log('\nScénario 3 — recordCheckpoint upsert');
    await auditVerifyService.recordCheckpoint(fixtures.ephemeralOrgId, result);
    const checkpoint = await prisma.audit_Checkpoint.findUnique({
      where: { organization_id: fixtures.ephemeralOrgId },
    });
    assert(checkpoint !== null, 'Audit_Checkpoint créé');
    assert(checkpoint?.last_row_count === 3, `last_row_count === 3 (reçu ${checkpoint?.last_row_count})`);

    // Scénario 4 : tampering signature
    console.log('\nScénario 4 — Tampering : UPDATE nouvelle_valeur → signature_mismatch');
    const tamperedId = fixtures.initialAuditIds[1];
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "Audit_Log" SET nouvelle_valeur = ${JSON.stringify({ tampered: true })}::jsonb WHERE id = ${tamperedId}`
    );
    result = await auditVerifyService.verifyChain({ organizationId: fixtures.ephemeralOrgId });
    assert(result.valid === false, 'valid:false après tampering');
    assert(result.brokenAtId === tamperedId, `brokenAtId === ${tamperedId} (reçu ${result.brokenAtId})`);
    assert(result.brokenAtReason === 'signature_mismatch', `brokenAtReason='signature_mismatch'`);

    // Scénario 5 : truncation
    console.log('\nScénario 5 — Truncation : DELETE dernière ligne → truncation détectée via checkpoint');
    // D'abord on remet une chaîne valide via reset (delete les 2 dernières, recrée propre)
    await prisma.$executeRaw(
      Prisma.sql`DELETE FROM "Audit_Log" WHERE organization_id = ${fixtures.ephemeralOrgId}`
    );
    fixtures.initialAuditIds = [];
    for (let i = 1; i <= 3; i++) {
      const log = await auditService.logAction({
        organizationId: fixtures.ephemeralOrgId,
        action: 'TEST_E2E',
        entity: 'E2E',
        entityId: `entity-${i}`,
        newValue: { i },
      });
      fixtures.initialAuditIds.push(log.id);
    }
    let r2 = await auditVerifyService.verifyChain({ organizationId: fixtures.ephemeralOrgId });
    await auditVerifyService.recordCheckpoint(fixtures.ephemeralOrgId, r2);

    // Maintenant on tronque
    const lastId = fixtures.initialAuditIds[2];
    await prisma.$executeRaw(
      Prisma.sql`DELETE FROM "Audit_Log" WHERE id = ${lastId}`
    );
    r2 = await auditVerifyService.verifyChain({ organizationId: fixtures.ephemeralOrgId });
    assert(r2.valid === false, 'valid:false après truncation');
    assert(r2.brokenAtReason === 'truncation', `brokenAtReason='truncation' (reçu ${r2.brokenAtReason})`);
    assert(r2.expectedRowCount === 3, `expectedRowCount === 3 (reçu ${r2.expectedRowCount})`);
    assert(r2.actualRowCount === 2, `actualRowCount === 2 (reçu ${r2.actualRowCount})`);
  } catch (err) {
    console.error('\n[E2E] Erreur fatale :', err);
    failures.push(`Exception: ${(err as Error).message}`);
  } finally {
    if (fixtures) {
      try {
        await cleanup(fixtures);
      } catch (e) {
        console.error('[E2E] Cleanup error :', e);
      }
    }
    await prisma.$disconnect();
    if (failures.length > 0) {
      console.error(`\n❌ ${failures.length} échec(s):`);
      failures.forEach((f) => console.error(`   - ${f}`));
      process.exitCode = 1;
    } else {
      console.log('\n✅ Tous les scénarios E2E audit verify sont passés.');
    }
  }
}

main();
