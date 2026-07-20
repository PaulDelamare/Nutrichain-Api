/**
 * E2E — la chaîne d'audit WORM ne forke pas sous écriture concurrente (issue #67).
 *
 * Ce que ça prouve, sur la vraie base Postgres (index unique + retry, pas un mock) :
 *   1. N écritures d'audit CONCURRENTES sur la MÊME organisation, chacune dans une transaction
 *      Serializable qui LIT avant d'écrire (le scénario de fork : le snapshot MVCC est figé tôt,
 *      la relecture du dernier maillon est donc périmée), produisent une chaîne LINÉAIRE.
 *   2. Toutes réussissent — le retry rejoue les perdantes, aucune écriture perdue.
 *   3. Exactement un genesis, et `verifyChain` renvoie valid.
 *
 * Sans le correctif (index unique `(organization_id, prev_hash)` + retryableTransaction), plusieurs
 * écritures chaîneraient sur le même prev_hash → fork → `verifyChain` renverrait prev_hash_mismatch.
 *
 * Lancement : npm run e2e:audit-chain
 * ⚠️ Nécessite la migration 20260720120000_audit_chain_unique_prev_hash.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../src/shared/configs/prismaClient.config';
import { auditService } from '../src/shared/utils/audit/audit.service';
import { retryableTransaction } from '../src/shared/utils/db/withWriteConflictRetry';
import { auditVerifyService } from '../src/modules/auditIntegrity/services/auditVerify.service';
import { GENESIS_PREV_HASH } from '../src/shared/utils/audit/auditHash.util';

const CONCURRENCY = 25;

const failures: string[] = [];
function assert(condition: boolean, label: string) {
  if (!condition) {
    failures.push(label);
    console.error(`  ❌ ${label}`);
  } else {
    console.log(`  ✅ ${label}`);
  }
}

async function main() {
  // Organisation jetable, isolée du seed : le test n'écrit et ne lit que sa propre chaîne.
  const orgId = `audit-e2e-${Date.now()}`;
  await prisma.organization.create({
    data: { id: orgId, name: 'Audit E2E', slug: orgId, createdAt: new Date(), metadata: '{}' },
  });

  try {
    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        retryableTransaction(
          async (tx) => {
            // Lecture d'abord : fige le snapshot Serializable AVANT l'écriture d'audit — c'est ce
            // qui rendait la relecture du dernier maillon périmée et provoquait le fork.
            await tx.audit_Log.count({ where: { organization_id: orgId } });
            return auditService.logAction(
              { organizationId: orgId, action: 'E2E_CONCURRENT', entity: 'Test', entityId: `e-${i}` },
              tx
            );
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        )
      )
    );

    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    assert(
      ok === CONCURRENCY,
      `les ${CONCURRENCY} écritures concurrentes réussissent (retry) — ${ok}/${CONCURRENCY}${
        rejected ? ` (1re erreur: ${rejected.reason})` : ''
      }`
    );

    const count = await prisma.audit_Log.count({ where: { organization_id: orgId } });
    assert(count === CONCURRENCY, `${CONCURRENCY} lignes d'audit persistées — ${count}`);

    const genesis = await prisma.audit_Log.count({
      where: { organization_id: orgId, prev_hash: GENESIS_PREV_HASH },
    });
    assert(genesis === 1, `exactement un genesis — ${genesis}`);

    const verify = await auditVerifyService.verifyChain({ organizationId: orgId });
    assert(verify.valid, `verifyChain valide — ${verify.brokenAtReason ?? 'ok'}`);
    assert(
      verify.rowsChecked === CONCURRENCY,
      `chaîne linéaire de ${CONCURRENCY} maillons — ${verify.rowsChecked}`
    );
  } finally {
    // Nettoyage de l'org jetable. Audit_Log.organization est onDelete Restrict → purger les logs
    // (et l'éventuel checkpoint) avant l'organisation.
    await prisma.audit_Log.deleteMany({ where: { organization_id: orgId } });
    await prisma.audit_Checkpoint.deleteMany({ where: { organization_id: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  }

  if (failures.length > 0) {
    console.error(`\n❌ e2e audit-chain : ${failures.length} échec(s)`);
    process.exit(1);
  }
  console.log('\n✅ e2e audit-chain : la chaîne WORM reste linéaire sous concurrence');
}

main().catch((err) => {
  console.error('[E2E] Erreur fatale :', err);
  process.exit(1);
});
