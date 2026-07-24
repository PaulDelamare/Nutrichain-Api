import { prisma } from '../../../shared/configs/prismaClient.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../shared/utils/audit/audit.service';
import { retryableTransaction } from '../../../shared/utils/db/withWriteConflictRetry';
import { ROLES } from '../../identity/constants/roles.constants';

const notFound = () =>
  new APIError(404, {
    error: [{ field: 'id', message: 'Membre introuvable ou accès refusé.' }],
  });

const denial = (message: string) => new APIError(403, { error: [{ field: 'member', message }] });

/**
 * Charge le membre cible dans l'organisation de l'appelant, et applique les gardes communes :
 * on ne touche jamais un `owner` (il ancre la gouvernabilité de l'org — un admin ne peut pas le
 * destituer), et on ne se cible jamais soi-même (auto-verrouillage).
 */
async function loadTarget(memberId: string, organizationId: string, actorUserId: string) {
  const member = await prisma.member.findFirst({
    where: { id: memberId, organizationId },
    include: { user: { select: { email: true } } },
  });
  if (!member) throw notFound();

  if (member.role === ROLES.OWNER) {
    throw denial("Le propriétaire de l'organisation ne peut pas être modifié depuis cette route.");
  }
  if (member.userId === actorUserId) {
    throw denial('Vous ne pouvez pas modifier votre propre accès.');
  }

  return member;
}

export const memberService = {
  async changeRole(memberId: string, role: string, organizationId: string, actorUserId: string) {
    const member = await loadTarget(memberId, organizationId, actorUserId);

    // Idempotent : réattribuer le rôle déjà en place n'ajoute pas de ligne d'audit fantôme.
    if (member.role === role) return member;

    const updated = await retryableTransaction(async (tx) => {
      const m = await tx.member.update({ where: { id: memberId }, data: { role } });
      await auditService.logAction(
        {
          organizationId,
          userId: actorUserId,
          action: 'CHANGE_MEMBER_ROLE',
          entity: 'Member',
          entityId: memberId,
          oldValue: { userId: member.userId, role: member.role },
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
    const member = await loadTarget(memberId, organizationId, actorUserId);

    await retryableTransaction(async (tx) => {
      await tx.member.delete({ where: { id: memberId } });
      await tx.session.deleteMany({ where: { userId: member.userId } });
      // L'e-mail vient du membre cible (serveur), jamais de l'appelant : on annule SES invitations.
      await tx.invitation.deleteMany({
        where: { email: member.user.email, status: 'pending', organizationId },
      });
      await auditService.logAction(
        {
          organizationId,
          userId: actorUserId,
          action: 'REVOKE_MEMBER',
          entity: 'Member',
          entityId: memberId,
          oldValue: { userId: member.userId, role: member.role },
        },
        tx
      );
    });
  },
};
