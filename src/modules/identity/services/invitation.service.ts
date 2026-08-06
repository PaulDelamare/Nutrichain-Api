import crypto from 'crypto';
import { render } from '@react-email/render';
import React from 'react';
import { bdd } from '../../../shared/configs/prismaClient.config';
import { sendEmail } from '../../../shared/utils/mailer/mailer';
import { InvitationEmail } from '../../../shared/utils/mailer/templates/InvitationEmail';
import { INVITATION_EXPIRATION_DAYS } from '../constants/roles.constants';
import { APIError } from '../../../shared/utils/errorHandler/APIError';

export interface CreateInvitationParams {
  /** Organisation cible — EXPLICITE : ne dépend pas d'une organisation active en session. */
  organizationId: string;
  inviterId: string;
  inviterEmail: string;
  email: string;
  role: string;
}

/**
 * Crée une invitation vers une organisation DONNÉE et envoie l'e-mail.
 *
 * Source unique des deux chemins d'invitation :
 *  - l'admin d'une organisation invite dans SA propre organisation (rôle restreint) ;
 *  - l'admin de plateforme invite le PREMIER owner d'une organisation qu'il vient de créer.
 *
 * L'organisation est un paramètre, jamais l'org active de l'appelant : c'est ce qui permet à
 * l'admin de plateforme (qui n'a pas d'org active) d'inviter, sans rouvrir de brèche cross-tenant
 * pour les admins d'organisation — eux restent bornés à leur org par `requireOrgRole` en amont.
 */
export async function createAndSendInvitation(params: CreateInvitationParams): Promise<{
  invitationId: string;
  expiresAt: Date;
}> {
  // `inviterEmail` reste dans les params (callers) mais n'est plus injecté dans le mail.
  const { organizationId, inviterId, email, role } = params;

  const targetOrg = await bdd.organization.findUnique({ where: { id: organizationId } });
  if (!targetOrg) {
    throw new APIError(404, {
      error: [{ field: 'organizationId', message: "L'organisation demandée n'existe pas." }],
    });
  }

  const existingUser = await bdd.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new APIError(400, {
      error: [{ field: 'email', message: 'Cet utilisateur possède déjà un compte.' }],
    });
  }

  await bdd.invitation.deleteMany({ where: { email, status: 'pending', organizationId } });

  const invitationId = crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRATION_DAYS);

  const invitation = await bdd.invitation.create({
    data: {
      id: invitationId,
      email,
      role,
      organizationId,
      inviterId,
      expiresAt,
      status: 'pending',
      createdAt: new Date(),
    },
  });

  // Nom affiché seulement — jamais l'email de l'invitant (évite de le diffuser aux destinataires).
  const inviter = await bdd.user.findUnique({
    where: { id: inviterId },
    select: { name: true, email: true },
  });
  const inviterDisplayName =
    inviter?.name?.trim() && inviter.name.trim() !== inviter.email
      ? inviter.name.trim()
      : null;

  const invitationLink = `${process.env.FRONTEND_URL}/inscription?token=${invitation.id}`;
  const htmlBody = await render(
    React.createElement(InvitationEmail, {
      email: invitation.email,
      role: invitation.role,
      invitationLink,
      inviterName: inviterDisplayName,
    })
  );

  await sendEmail({
    to: invitation.email,
    subject: `Rejoignez la zone NutriChain : ${targetOrg.name}`,
    html: htmlBody,
  });

  return { invitationId: invitation.id, expiresAt };
}
