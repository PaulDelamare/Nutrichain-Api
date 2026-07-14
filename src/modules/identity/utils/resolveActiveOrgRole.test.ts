import { describe, it, expect, vi, beforeEach } from 'vitest';

const findFirst = vi.fn();

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: { member: { findFirst: (...a: unknown[]) => findFirst(...a) } },
}));

const { resolveActiveOrgRole } = await import('./resolveActiveOrgRole');

beforeEach(() => {
  findFirst.mockReset();
});

describe('resolveActiveOrgRole', () => {
  it("renvoie le rôle du membre dans l'organisation active", async () => {
    findFirst.mockResolvedValue({ role: 'viewer' });

    await expect(resolveActiveOrgRole('moi', 'org-1')).resolves.toBe('viewer');
  });

  // Sans cette assertion, supprimer le filtre renverrait le rôle de N'IMPORTE QUEL membre
  // de N'IMPORTE QUELLE organisation — un viewer se verrait owner.
  it("cherche le membre par utilisateur ET par organisation active", async () => {
    findFirst.mockResolvedValue({ role: 'operator' });

    await resolveActiveOrgRole('moi', 'org-1');

    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 'moi', organizationId: 'org-1' },
      select: { role: true },
    });
  });

  it("renvoie null sans organisation active, sans interroger la base", async () => {
    await expect(resolveActiveOrgRole('moi', undefined)).resolves.toBeNull();

    expect(findFirst).not.toHaveBeenCalled();
  });

  it("renvoie null quand l'utilisateur n'est pas membre de l'organisation active", async () => {
    findFirst.mockResolvedValue(null);

    await expect(resolveActiveOrgRole('moi', 'org-1')).resolves.toBeNull();
  });

  // `Member.role` est un String libre dont le défaut Prisma est « member », et la passerelle
  // Better-Auth accepte un rôle arbitraire : un rôle hors référentiel n'accorde aucun droit.
  it.each(['member', 'superuser', 'OWNER', ''])(
    'refuse le rôle hors référentiel « %s » plutôt que de le transmettre au front',
    async (role) => {
      findFirst.mockResolvedValue({ role });

      await expect(resolveActiveOrgRole('moi', 'org-1')).resolves.toBeNull();
    }
  );

  it('ne masque pas une panne de base — /me doit échouer franchement, pas nier les droits', async () => {
    findFirst.mockRejectedValue(new Error('base injoignable'));

    await expect(resolveActiveOrgRole('moi', 'org-1')).rejects.toThrow('base injoignable');
  });
});
