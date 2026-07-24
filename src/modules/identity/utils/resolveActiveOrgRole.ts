import { prisma } from '../../../shared/configs/prismaClient.config';
import { ALL_ROLES, type Role } from '../constants/roles.constants';

/**
 * Rôle du membre dans son organisation active, ou `null` s'il n'y en a pas.
 *
 * Sert à `/api/me` : le front doit connaître SON rôle pour n'exposer que les actions qu'il a le
 * droit d'exécuter. Il ne le pouvait pas — la seule route qui portait les rôles
 * (`/organization/members`) est réservée à `PERSONAL_DATA_ROLES`, donc un `viewer` y recevait 403 et
 * ne pouvait pas lire son propre rôle. Or son propre rôle n'est pas une donnée personnelle d'autrui.
 *
 * On lit `member` directement, et non `auth.api.getFullOrganization` (que `requireOrgRole` utilise) :
 * cet endpoint refait un `getSession`, charge TOUS les membres, invitations et utilisateurs de
 * l'organisation en mémoire — à chaque rendu SSR du front — et, quand l'appelant n'est plus membre,
 * remet l'organisation active à `null` EN BASE. Une introspection de session ne doit rien muter.
 * La source de vérité reste la même table `Member.role` que celle qu'évalue `requireOrgRole`.
 *
 * Le rôle est VALIDÉ, jamais casté : la colonne est un `String` libre dont le défaut Prisma est
 * `member`, et la passerelle Better-Auth accepte un rôle arbitraire. Un rôle hors référentiel
 * n'accorde aucun droit — il ne doit pas arriver au front déguisé en `Role`.
 */
export async function resolveActiveOrgRole(
  userId: string,
  activeOrgId: string | undefined
): Promise<Role | null> {
  if (!activeOrgId) return null;

  const member = await prisma.member.findFirst({
    where: { userId, organizationId: activeOrgId },
    select: { role: true },
  });

  if (!member) return null;

  return (ALL_ROLES as string[]).includes(member.role) ? (member.role as Role) : null;
}
