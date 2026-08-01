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

  /**
   * #294 — La signature était calculée sur l'objet en mémoire, dans l'ordre d'insertion, et
   * recalculée sur l'objet relu de `jsonb`, qui réordonne les clés (par longueur puis octets, et
   * récursivement). Toute charge dont les clés n'étaient pas déjà dans cet ordre était déclarée
   * falsifiée. Sur la base de développement, 222 maillons sur 257 étaient dans ce cas.
   *
   * Ce test ne peut pas être unitaire : c'est l'aller-retour `jsonb` qui est en cause, et le mocker
   * reviendrait à comparer la formule à elle-même.
   */
  it('vérifie une charge dont les clés ne sont pas dans l’ordre de `jsonb` (#294)', async () => {
    const orgDesordre = `audit-it-desordre-${Date.now()}`;
    await prisma.organization.create({
      data: {
        id: orgDesordre,
        name: 'Audit IT desordre',
        slug: orgDesordre,
        createdAt: new Date(),
        metadata: '{}',
      },
    });

    try {
      await retryableTransaction((tx) =>
        auditService.logAction(
          {
            organizationId: orgDesordre,
            action: 'IT_KEY_ORDER',
            entity: 'Test',
            entityId: 'e-1',
            // Chaque niveau est volontairement hors de l'ordre de `jsonb` : racine, objet imbriqué,
            // et objets À L'INTÉRIEUR d'un tableau — c'est ce dernier cas que produisent les
            // charges réelles (`lots: [{ id_lot, quantite }]`) et qu'un tri non récursif rate.
            //
            // Et surtout une `Date` et un `Decimal` : sans eux, cette charge ne ressemble à aucune
            // charge réelle. Les services journalisent l'entité Prisma entière, et une
            // canonicalisation qui reconstruit les objets clé par clé réduit ces deux types à `{}`.
            // Un test sur des nombres seuls reste vert sur ce défaut — c'est le biais du golden
            // vector à clé unique, reproduit.
            newValue: {
              zzzz: 1,
              a: { nested: 1, b: 2 },
              date_reception: new Date('2026-07-31T10:00:00.000Z'),
              quantite: new Prisma.Decimal('12.5'),
              list: [
                { y: 1, x: 2 },
                { y: 3, x: 4 },
              ],
            },
          },
          tx
        )
      );

      const verify = await auditVerifyService.verifyChain({ organizationId: orgDesordre });
      expect(verify.valid).toBe(true);
      expect(verify.rowsChecked).toBe(1);
    } finally {
      await prisma.audit_Log.deleteMany({ where: { organization_id: orgDesordre } });
      await prisma.audit_Checkpoint.deleteMany({ where: { organization_id: orgDesordre } });
      await prisma.organization.deleteMany({ where: { id: orgDesordre } });
    }
  }, 30_000);

});
