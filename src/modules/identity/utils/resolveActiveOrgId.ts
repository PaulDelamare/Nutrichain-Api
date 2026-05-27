import { prisma } from '../../../shared/configs/prismaClient.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { AuthenticatedRequest } from '../types/auth.types';

/**
 * Retourne l'organisation active de la session, ou la première organisation du membre.
 */
export async function resolveActiveOrgId(req: AuthenticatedRequest): Promise<string> {
  const fromSession = req.activeOrgId || req.auth?.activeOrgId;
  if (fromSession) return fromSession;

  const userId = req.auth?.user?.id ?? req.user?.id;
  if (!userId) {
    throw new APIError(401, {
      error: [{ field: 'auth', message: 'Non authentifié.' }],
    });
  }

  const member = await prisma.member.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });

  if (!member) {
    throw new APIError(400, {
      error: [{ field: 'organization', message: 'Aucune organisation associée à ce compte.' }],
    });
  }

  return member.organizationId;
}
