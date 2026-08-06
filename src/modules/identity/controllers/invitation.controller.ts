import { Response } from 'express';
import { bdd } from '../../../shared/configs/prismaClient.config';
import { AuthenticatedRequest } from '../types/auth.types';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { createAndSendInvitation } from '../services/invitation.service';

export const generateInvitation = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const { email, role } = req.body;
  const auth = req.auth!;
  // La cible est TOUJOURS l'organisation active : la vérification organizationId === activeOrgId a
  // été déportée dans requireOrgRole. Une usurpation d'ID d'organisation est bloquée en amont.
  const activeOrgId = auth.activeOrgId!;

  const { invitationId, expiresAt } = await createAndSendInvitation({
    organizationId: activeOrgId,
    inviterId: auth.user.id,
    inviterName: auth.user.name,
    email,
    role,
  });

  sendSuccess(res, 201, 'Invitation générée et envoyée avec succès.', { invitationId, expiresAt });
});

/**
 * Prévisualisation publique d'une invitation (page d'inscription du front,
 * avant toute session). Volontairement minimal : email, rôle, statut,
 * expiration — la validation dure (statut/expiration) reste dans guardSignUp
 * au moment du sign-up.
 */
export const previewInvitation = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const token = req.params.token as string;

  const invitation = await bdd.invitation.findFirst({
    where: { id: token },
    select: { email: true, role: true, status: true, expiresAt: true },
  });

  if (!invitation) {
    throw new APIError(404, {
      error: [{ field: 'token', message: 'Invitation introuvable ou lien invalide.' }],
    });
  }

  sendSuccess(res, 200, 'Invitation récupérée', invitation);
});
