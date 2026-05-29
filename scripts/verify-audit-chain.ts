/**
 * Vérifie l'intégrité de la hash chain Audit_Log pour toutes les organisations.
 * Sortie : exit 0 si toutes les chains sont valides, exit 1 si au moins une est broken.
 *
 * Pratique pour la CI ou un check ops manuel post-restore.
 *
 * Lancement : `npm run verify:audit-chain`.
 */
import { prisma } from '../src/shared/configs/prismaClient.config';
import { auditVerifyService } from '../src/modules/auditIntegrity/services/auditVerify.service';

async function main(): Promise<void> {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  if (orgs.length === 0) {
    console.log('[verify-audit-chain] Aucune org en DB.');
    return;
  }

  let brokenCount = 0;
  for (const org of orgs) {
    const r = await auditVerifyService.verifyChain({ organizationId: org.id });
    if (r.valid) {
      console.log(`✅ ${org.name} (${org.id}) — rows=${r.rowsChecked}`);
    } else {
      brokenCount++;
      console.error(
        `❌ ${org.name} (${org.id}) — brokenAtId=${r.brokenAtId} reason=${r.brokenAtReason} expectedRowCount=${r.expectedRowCount} actualRowCount=${r.actualRowCount}`
      );
    }
  }

  if (brokenCount > 0) {
    console.error(`\n[verify-audit-chain] ${brokenCount} chaîne(s) corrompue(s).`);
    process.exitCode = 1;
  } else {
    console.log(`\n[verify-audit-chain] OK — ${orgs.length} chaîne(s) valides.`);
  }
}

main()
  .catch((err) => {
    console.error('[verify-audit-chain] Erreur fatale :', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
