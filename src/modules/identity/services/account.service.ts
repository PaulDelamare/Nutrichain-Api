import { prisma } from '../../../shared/configs/prismaClient.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../shared/utils/audit/audit.service';
import { retryableTransaction } from '../../../shared/utils/db/withWriteConflictRetry';
import { ROLES } from '../constants/roles.constants';

/**
 * Droit à l'effacement (RGPD, cf. #107) : ANONYMISE, ne supprime pas.
 *
 * `User.id` est référencé sans compter par `created_by`/`id_user`/`received_by` dans les tables
 * métier ET par `Audit_Log.id_user` — le supprimer romprait la traçabilité HACCP et la chaîne WORM
 * (qui ne doit jamais perdre un maillon). L'identité redevient anonyme, l'ID reste pour
 * l'intégrité référentielle : c'est la mitigation déjà posée dans le DPIA (`docs/23_DPIA.md` §5).
 */
export const accountService = {
  /**
   * Anonymise le compte de l'utilisateur authentifié : lui seul peut demander l'effacement de SES
   * propres données (aucun paramètre d'identité ne vient du corps de la requête).
   */
  async deleteMyAccount(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
    if (!user) {
      throw new APIError(404, {
        error: [{ field: 'user', message: 'Utilisateur introuvable.' }],
      });
    }

    // Une organisation ne peut pas se retrouver sans propriétaire du jour au lendemain : le
    // propriétaire doit céder la place (`POST /organization/members/:id/transfer-ownership`,
    // issue #112) AVANT de pouvoir supprimer son propre compte.
    const membership = await prisma.member.findUnique({
      where: { userId },
      select: { id: true, role: true, organizationId: true },
    });
    if (membership?.role === ROLES.OWNER) {
      throw new APIError(409, {
        error: [
          {
            field: 'user',
            message:
              "Vous êtes propriétaire d'une organisation : transférez la propriété avant de supprimer votre compte.",
          },
        ],
      });
    }

    // Empreinte lisible sans exposer l'e-mail réel en clair dans l'anonymisation elle-même —
    // déterministe sur l'ID, donc garantie unique (contrainte `User.email @unique`).
    const anonymizedEmail = `compte-supprime-${userId}@anonymise.nutrichain.local`;

    await retryableTransaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          email: anonymizedEmail,
          name: 'Compte supprimé',
          image: null,
          emailVerified: false,
        },
      });

      // Coupe tout moyen de se reconnecter : sessions actives ET identifiants (mot de passe).
      await tx.session.deleteMany({ where: { userId } });
      await tx.account.deleteMany({ where: { userId } });
      await tx.twoFactor.deleteMany({ where: { userId } });

      if (membership) {
        await tx.member.delete({ where: { id: membership.id } });

        // La chaîne d'audit WORM est scellée PAR ORGANISATION (Audit_Log.organization_id est
        // requis) : un utilisateur sans organisation (cas du seul compte plateforme) n'a aucun
        // journal auquel rattacher cette écriture — l'anonymisation elle-même reste inconditionnelle.
        await auditService.logAction(
          {
            organizationId: membership.organizationId,
            userId,
            action: 'USER_ANONYMIZED',
            entity: 'User',
            entityId: userId,
            oldValue: { email: user.email, name: user.name },
            newValue: { email: anonymizedEmail, name: 'Compte supprimé' },
          },
          tx
        );
      }
    });
  },
};
