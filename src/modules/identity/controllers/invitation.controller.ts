import { Response, Request } from 'express';
import crypto from 'crypto';
import { bdd } from '../../../shared/configs/prismaClient.config';
import { sendEmail } from '../../../shared/utils/mailer/mailer';
import { render } from '@react-email/render';
import { InvitationEmail } from '../../../shared/utils/mailer/templates/InvitationEmail';
import React from 'react';
import { INVITATION_EXPIRATION_DAYS } from '../constants/roles.constants';
import { AuthenticatedRequest } from '../types/auth.types';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';

export const generateInvitation = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  const { email, role } = req.body;
  const auth = req.auth!;
  const activeOrgId = auth.activeOrgId!;

  // NOTE SÉCURITÉ : La vérification organizationId === activeOrgId a été déportée
  // dans le middleware requireOrgRole pour éviter la duplication.
  // Une tentative d'usurpation d'ID organisation est bloquée en amont.

  const inviterId = auth.user.id;
  const inviterEmail = auth.user.email;

  // Vérifier que l'organisation (Zone) existe bien
  const targetOrg = await bdd.organization.findUnique({
    where: { id: activeOrgId },
  });

  if (!targetOrg) {
    throw new APIError(404, {
      error: [
        { field: 'organizationId', message: "La zone (Organisation) demandée n'existe pas." },
      ],
    });
  }

  // Vérifier si l'utilisateur n'a pas déjà un compte existant
  const existingUser = await bdd.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new APIError(400, {
      error: [{ field: 'email', message: 'Cet utilisateur possède déjà un compte.' }],
    });
  }

  // Nettoyer d'éventuelles anciennes invitations 'pending' pour cet email
  await bdd.invitation.deleteMany({
    where: { email, status: 'pending' },
  });

  // 1. Créer l'invitation dans la base de données
  const invitationId = crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRATION_DAYS);

  const invitation = await bdd.invitation.create({
    data: {
      id: invitationId,
      email,
      role,
      organizationId: activeOrgId,
      inviterId,
      expiresAt,
      status: 'pending',
      createdAt: new Date(),
    },
  });

  // 2. Générer l'URL et le template Mail
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  const invitationLink = `${frontendUrl}/inscription?token=${invitation.id}`;

  const htmlBody = await render(
    React.createElement(InvitationEmail, {
      email: invitation.email,
      role: invitation.role,
      invitationLink,
      inviterName: inviterEmail,
    })
  );

  // 3. Envoyer l'email
  await sendEmail({
    to: invitation.email,
    subject: `Rejoignez la zone NutriChain : ${targetOrg.name}`,
    html: htmlBody,
  });

  sendSuccess(res, 201, 'Invitation générée et envoyée avec succès.', {
    invitationId: invitation.id,
    expiresAt,
  });
});

export const previewInvitation = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const invitation = await bdd.invitation.findUnique({
    where: { id },
    select: { email: true, role: true, status: true, expiresAt: true },
  });

  if (!invitation || invitation.status !== 'pending' || invitation.expiresAt <= new Date()) {
    throw new APIError(404, {
      error: [{ field: 'token', message: 'Invitation invalide ou expirée.' }],
    });
  }

  sendSuccess(res, 200, 'Invitation valide.', invitation);
});
