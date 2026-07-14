import { prisma } from '../../../shared/configs/prismaClient.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../shared/utils/audit/audit.service';
import { ROLES } from '../../identity/constants/roles.constants';

const introuvable = () =>
  new APIError(404, {
    error: [{ field: 'id', message: 'Membre introuvable ou accès refusé.' }],
  });

const refus = (message: string) => new APIError(403, { error: [{ field: 'member', message }] });

/**
 * Charge le membre cible dans l'organisation de l'appelant, et applique les gardes communes :
 * on ne touche jamais un `owner` (il ancre la gouvernabilité de l'org — un admin ne peut pas le
 * destituer), et on ne se cible jamais soi-même (auto-verrouillage).
 */
async function chargerCible(memberId: string, organizationId: string, actorUserId: string) {
  const membre = await prisma.member.findFirst({
    where: { id: memberId, organizationId },
    include: { user: { select: { email: true } } },
  });
  if (!membre) throw introuvable();

  if (membre.role === ROLES.OWNER) {
    throw refus("Le propriétaire de l'organisation ne peut pas être modifié depuis cette route.");
  }
  if (membre.userId === actorUserId) {
    throw refus('Vous ne pouvez pas modifier votre propre accès.');
  }

  return membre;
}

export const memberService = {
  async changeRole(memberId: string, role: string, organizationId: string, actorUserId: string) {
    const membre = await chargerCible(memberId, organizationId, actorUserId);

    // Idempotent : réattribuer le rôle déjà en place n'ajoute pas de ligne d'audit fantôme.
    if (membre.role === role) return membre;

    const updated = await prisma.$transaction(async (tx) => {
      const m = await tx.member.update({ where: { id: memberId }, data: { role } });
      await auditService.logAction(
        {
          organizationId,
          userId: actorUserId,
          action: 'CHANGE_MEMBER_ROLE',
          entity: 'Member',
          entityId: memberId,
          oldValue: { userId: membre.userId, role: membre.role },
          newValue: { role },
        },
        tx
      );
      return m;
    });

    return updated;
  },

  /**
   * Révoque l'accès : supprime le Member, et — dans la MÊME transaction — supprime les sessions du
   * révoqué (vrai « kick » : il n'est plus authentifié) et annule ses invitations pending (sinon il
   * pourrait re-rejoindre). L'audit est écrit dans la transaction, sinon un crash laisserait un accès
   * retiré sans trace WORM.
   */
  async revoke(memberId: string, organizationId: string, actorUserId: string) {
    const membre = await chargerCible(memberId, organizationId, actorUserId);

    await prisma.$transaction(async (tx) => {
      await tx.member.delete({ where: { id: memberId } });
      await tx.session.deleteMany({ where: { userId: membre.userId } });
      // L'e-mail vient du membre cible (serveur), jamais de l'appelant : on annule SES invitations.
      await tx.invitation.deleteMany({
        where: { email: membre.user.email, status: 'pending', organizationId },
      });
      await auditService.logAction(
        {
          organizationId,
          userId: actorUserId,
          action: 'REVOKE_MEMBER',
          entity: 'Member',
          entityId: memberId,
          oldValue: { userId: membre.userId, role: membre.role },
        },
        tx
      );
    });
  },
};
