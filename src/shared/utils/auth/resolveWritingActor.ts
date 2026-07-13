import { prisma } from '../../configs/prismaClient.config';
import { APIError } from '../errorHandler/APIError';

interface ResolveWritingActorParams {
  /** Identité issue de la session authentifiée. Fait toujours foi. */
  sessionUserId?: string;
  /** Identité déclarée par un client M2M (clé API). Ne fait foi qu'après vérification. */
  actorUserId?: string;
  organizationId: string;
  allowedRoles: readonly string[];
}

/**
 * Qui signe une écriture ? Cette identité est scellée dans la chaîne d'audit WORM : elle ne peut
 * pas être choisie librement par le client.
 *
 * - En session, elle vient de la session. Le corps de la requête est ignoré.
 * - En M2M (clé API), il n'y a pas de session : le client déclare l'acteur, et on VÉRIFIE qu'il
 *   est bien membre de CETTE organisation avec un rôle autorisé. Sans cette garde, n'importe quel
 *   utilisateur — y compris d'une autre organisation — pouvait être scellé comme auteur.
 *
 * Note : l'identifiant utilisateur est une chaîne opaque (Better-Auth). On ne lui impose aucun
 * format : la sécurité vient de la vérification d'appartenance, pas de la forme de l'id.
 */
export async function resolveWritingActor({
  sessionUserId,
  actorUserId,
  organizationId,
  allowedRoles,
}: ResolveWritingActorParams): Promise<string> {
  if (sessionUserId) {
    return sessionUserId;
  }

  if (!actorUserId) {
    throw new APIError(400, {
      error: [
        {
          field: 'actorUserId',
          message:
            "actorUserId requis en mode M2M (clé API). En mode session, l'utilisateur est résolu depuis la session.",
        },
      ],
    });
  }

  const member = await prisma.member.findFirst({
    where: {
      userId: actorUserId,
      organizationId,
      role: { in: [...allowedRoles] },
    },
    select: { id: true },
  });

  if (!member) {
    throw new APIError(403, {
      error: [{ field: 'actorUserId', message: 'Utilisateur non membre ou rôle insuffisant' }],
    });
  }

  return actorUserId;
}
