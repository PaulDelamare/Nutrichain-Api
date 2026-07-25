import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../../configs/prismaClient.config';

/**
 * `onDelete: Restrict` n'existe que dans PostgreSQL : un mock Prisma laisserait passer
 * `organization.delete()` sans jamais lever, alors que la base refuse réellement l'opération
 * (#150). Ces gardes sont volontaires (cf. commentaires du schéma) — ce test prouve qu'elles sont
 * bien appliquées, pas seulement déclarées.
 */
describe('cascades et onDelete: Restrict (PostgreSQL réel)', () => {
  const orgId = `it-restrict-${Date.now()}`;

  afterAll(async () => {
    // Nettoyage dans l'ordre qui respecte les mêmes contraintes qu'on vient de prouver.
    await prisma.audit_Log.deleteMany({ where: { organization_id: orgId } });
    await prisma.ePCIS_Event.deleteMany({ where: { organization_id: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  it("refuse de supprimer une organisation tant qu'une ligne d'audit WORM y fait référence", async () => {
    await prisma.organization.create({
      data: { id: orgId, name: 'IT Restrict', slug: orgId, createdAt: new Date(), metadata: '{}' },
    });
    await prisma.audit_Log.create({
      data: {
        organization_id: orgId,
        action: 'IT_TEST',
        entity: 'Test',
        entity_id: 'e-1',
        prev_hash: '0'.repeat(64),
        signature_hash: '1'.repeat(64),
      },
    });

    await expect(prisma.organization.delete({ where: { id: orgId } })).rejects.toMatchObject({
      code: 'P2003',
    });
  });

  it("refuse de supprimer une organisation tant qu'un événement EPCIS y fait référence (même après avoir purgé l'audit)", async () => {
    // La ligne d'audit du test précédent bloque déjà : on la retire pour isoler CETTE contrainte.
    await prisma.audit_Log.deleteMany({ where: { organization_id: orgId } });
    await prisma.ePCIS_Event.create({
      data: {
        organization_id: orgId,
        event_time: new Date(),
        event_type: 'ObjectEvent',
        related_entity: 'Test',
        related_id: 'e-1',
        payload: {},
      },
    });

    await expect(prisma.organization.delete({ where: { id: orgId } })).rejects.toMatchObject({
      code: 'P2003',
    });
  });

  /**
   * Cas de contraste : la contrainte ne bloque pas TOUTE suppression, seulement celle d'une
   * organisation encore référencée. Sans ce test, une assertion qui échoue toujours passerait.
   */
  it('supprime sans erreur une organisation SANS référence (aucun audit, aucun événement)', async () => {
    const emptyOrgId = `it-restrict-empty-${Date.now()}`;
    await prisma.organization.create({
      data: {
        id: emptyOrgId,
        name: 'IT Restrict Empty',
        slug: emptyOrgId,
        createdAt: new Date(),
        metadata: '{}',
      },
    });

    await expect(prisma.organization.delete({ where: { id: emptyOrgId } })).resolves.toBeDefined();
  });
});
