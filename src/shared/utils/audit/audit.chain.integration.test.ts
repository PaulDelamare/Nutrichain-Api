import { describe, it, expect, afterAll } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../../configs/prismaClient.config';
import { auditService } from './audit.service';
import { retryableTransaction } from '../db/withWriteConflictRetry';
import { auditVerifyService } from '../../../modules/auditIntegrity/services/auditVerify.service';
import { GENESIS_PREV_HASH } from './auditHash.util';

/**
 * Contre un vrai PostgreSQL (index unique `(organization_id, prev_hash)` + retry sur conflit de
 * sérialisation), pas un mock : un mock rendrait `count: 1` là où Postgres rendrait `0`, et ne
 * connaît ni contrainte ni niveau d'isolation (#150). Conversion du scénario déjà prouvé par
 * `scripts/e2e-audit-chain.ts`, ici exécutée automatiquement par la CI plutôt qu'à la main.
 */
describe("chaîne d'audit WORM sous écriture concurrente (PostgreSQL réel)", () => {
  const CONCURRENCY = 25;
  const orgId = `audit-it-${Date.now()}`;

  afterAll(async () => {
    // Audit_Log.organization est onDelete Restrict → purger les logs (et l'éventuel checkpoint)
    // avant l'organisation.
    await prisma.audit_Log.deleteMany({ where: { organization_id: orgId } });
    await prisma.audit_Checkpoint.deleteMany({ where: { organization_id: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  it('reste linéaire (pas de fork) quand N écritures concurrentes ciblent la même organisation', async () => {
    await prisma.organization.create({
      data: { id: orgId, name: 'Audit IT', slug: orgId, createdAt: new Date(), metadata: '{}' },
    });

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        retryableTransaction(
          async (tx) => {
            // Lecture d'abord : fige le snapshot Serializable AVANT l'écriture d'audit — c'est ce
            // qui rendait la relecture du dernier maillon périmée et provoquait le fork.
            await tx.audit_Log.count({ where: { organization_id: orgId } });
            return auditService.logAction(
              { organizationId: orgId, action: 'IT_CONCURRENT', entity: 'Test', entityId: `e-${i}` },
              tx
            );
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        )
      )
    );

    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(CONCURRENCY);

    const count = await prisma.audit_Log.count({ where: { organization_id: orgId } });
    expect(count).toBe(CONCURRENCY);

    const genesis = await prisma.audit_Log.count({
      where: { organization_id: orgId, prev_hash: GENESIS_PREV_HASH },
    });
    expect(genesis).toBe(1);

    const verify = await auditVerifyService.verifyChain({ organizationId: orgId });
    expect(verify.valid).toBe(true);
    expect(verify.rowsChecked).toBe(CONCURRENCY);
  }, 30_000);
});
