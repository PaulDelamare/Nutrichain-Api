import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { auditService } from '../../../shared/utils/audit/audit.service';
import { advisoryLockKey } from '../../../shared/utils/db/advisoryLockKey';
import { runAuditChainVerifyOnce } from './auditChainVerify.job';

/**
 * `pg_try_advisory_xact_lock` n'existe que dans PostgreSQL : un mock ne peut ni le poser, ni
 * prouver qu'il se relâche vraiment à la fin de la transaction. C'est exactement ce qu'un verrou
 * consultatif de SESSION laissait fuiter en silence — pris et relâché par deux requêtes Prisma
 * distinctes, donc potentiellement sur deux connexions différentes du pool (#238, même défaut que
 * #150 côté IoT).
 *
 * Les exécutions concurrentes ci-dessous ne sont pas décoratives : c'est la concurrence qui force
 * le pool à distribuer plusieurs connexions, et donc qui rend la fuite observable.
 */
describe("verrou consultatif du job de vérification d'audit (PostgreSQL réel)", () => {
  const ORG_ID = `it-auditlock-${Date.now()}`;
  const REPLIQUES_SIMULTANEES = 4;
  const LOCK_NAMESPACE = 'audit-chain-verify';

  beforeAll(async () => {
    await prisma.organization.create({
      data: {
        id: ORG_ID,
        name: 'IT Audit Lock',
        slug: ORG_ID,
        createdAt: new Date(),
        metadata: '{}',
      },
    });
    // Une chaîne d'audit valide et non vide : sans ligne, `verifyChain` n'écrit aucun checkpoint
    // et le test ne pourrait pas distinguer « vérifié » de « sauté ».
    for (let i = 0; i < 3; i++) {
      await auditService.logAction({
        organizationId: ORG_ID,
        action: 'IT_LOCK_PROBE',
        entity: 'Test',
        entityId: `probe-${i}`,
        newValue: { i },
      });
    }
  });

  afterAll(async () => {
    await prisma.audit_Checkpoint.deleteMany({ where: { organization_id: ORG_ID } });
    // Audit_Log.organization est onDelete Restrict (chaîne WORM) : purger avant l'organisation.
    await prisma.audit_Log.deleteMany({ where: { organization_id: ORG_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  });

  /** Verrous consultatifs actuellement détenus pour la clé de CETTE organisation. */
  const verrousDetenus = async (): Promise<number> => {
    const cle = advisoryLockKey(LOCK_NAMESPACE, ORG_ID);
    const high = cle >> 32n;
    const low = cle & 0xffffffffn;
    const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM pg_locks
        WHERE locktype = 'advisory' AND classid = ${high} AND objid = ${low}`
    );
    return Number(rows[0].count);
  };

  it(
    'ne laisse aucun verrou détenu et ne rend pas muettes les vérifications suivantes',
    async () => {
      await Promise.all(
        Array.from({ length: REPLIQUES_SIMULTANEES }, () => runAuditChainVerifyOnce())
      );

      // 1. Le verrou de transaction est retombé au commit, sur quelque connexion que ce soit.
      expect(await verrousDetenus()).toBe(0);

      // 2. La vérification a réellement eu lieu : une seule réplique gagne le verrou, mais elle
      //    fait le travail — un checkpoint est écrit pour l'organisation.
      const checkpoint = await prisma.audit_Checkpoint.findUnique({
        where: { organization_id: ORG_ID },
      });
      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.last_row_count).toBe(3);

      // 3. La conséquence réelle d'un verrou fuité : l'exécution SUIVANTE ne vérifie plus rien,
      //    sur toutes les instances, sans autre trace qu'un `warn`. On la rejoue donc à blanc.
      await prisma.audit_Checkpoint.delete({ where: { organization_id: ORG_ID } });
      await runAuditChainVerifyOnce();

      expect(
        await prisma.audit_Checkpoint.findUnique({ where: { organization_id: ORG_ID } })
      ).not.toBeNull();
      expect(await verrousDetenus()).toBe(0);
    },
    60_000
  );
});
