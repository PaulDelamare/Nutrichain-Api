import { Prisma } from '@prisma/client';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { QUALITY_ROLES } from '../../../identity/constants/roles.constants';

/** Ce qui est inscrit dans l'audit quand la règle n'a pas pu s'appliquer. */
export const SELF_RELEASE_TRACE = 'AUTO_SIGNEE_AUCUN_AUTRE_DECIDEUR';

/**
 * Séparation des tâches HACCP : on ne libère pas le lot dont on est soi-même à l'origine.
 *
 * Le RBAC seul ne la garantit pas. `owner` et `admin` appartiennent à la fois à `WRITE_ROLES` et à
 * `QUALITY_ROLES` : ils enregistrent un lot ET signent sa libération. Retirer `admin` du bloc
 * qualité casserait les structures réduites, où il est parfois le seul présent — la règle porte
 * donc sur la PERSONNE, pas sur le rôle.
 *
 * Elle ne s'applique que s'il existe quelqu'un d'autre pour décider. Sans cet échappement, une
 * organisation d'un seul membre — l'état de TOUTE organisation à sa création — voyait ses lots
 * définitivement figés : y compris ceux mis en quarantaine automatiquement par une excursion de
 * température, donc du stock immobilisé sans aucun recours. Quand la séparation est impossible,
 * on laisse passer et **on l'écrit dans l'audit** : une décision auto-signée reste opposable, à
 * condition d'être reconnaissable.
 *
 * ⚠️ À n'appeler que sur une décision LIBÉRATOIRE. Jamais sur une décision restrictive : déclarer
 * son propre lot non conforme, ou déclencher un rappel, doit rester possible — sinon on décourage
 * précisément la remontée que l'on cherche à obtenir.
 *
 * @returns `true` si la décision est auto-signée faute d'un second décideur (à tracer).
 */
export async function enforceSeparationOfDuties(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    /** Auteur de l'enregistrement du lot (`Batch.created_by`). */
    batchCreatedBy: string;
    actorUserId: string;
    /** Champ auquel le front doit rattacher le message. */
    field: string;
  }
): Promise<boolean> {
  if (params.batchCreatedBy !== params.actorUserId) return false;

  const autreDecideur = await tx.member.findFirst({
    where: {
      organizationId: params.organizationId,
      userId: { not: params.actorUserId },
      role: { in: QUALITY_ROLES },
    },
    select: { id: true },
  });

  if (!autreDecideur) return true;

  throw new APIError(403, {
    error: [
      {
        field: params.field,
        message:
          "Vous avez enregistré ce lot : sa libération doit être signée par une autre personne habilitée (séparation des tâches). Vous pouvez en revanche le déclarer non conforme.",
      },
    ],
  });
}
