import { Request, Response } from 'express';
import crypto from 'crypto';
import { bdd } from '../../../shared/configs/prismaClient.config';
import { sendEmail } from '../../../shared/utils/mailer/mailer';
import { render } from '@react-email/render';
import { InvitationEmail } from '../../../shared/utils/mailer/templates/InvitationEmail';
import React from 'react';
import { INVITATION_EXPIRATION_DAYS } from '../constants/roles.constants';

export const generateInvitation = async (req: Request, res: Response) => {
  try {
    const { email, role, organizationId } = req.body;

    // req.user est injecté par requireAuth.middleware
    const inviterId = (req as unknown).user?.id;
    const inviterEmail = (req as unknown).user?.email || 'Administrateur';

    if (!inviterId) {
      res
        .status(401)
        .json({ status: 401, message: "Utilisateur non identifié pour créer l'invitation." });
      return;
    }

    // Vérifier que l'organisation (Zone) existe bien
    const targetOrg = await bdd.organization.findUnique({
      where: { id: organizationId },
    });

    if (!targetOrg) {
      res
        .status(404)
        .json({ status: 404, message: "La zone (Organisation) demandée n'existe pas." });
      return;
    }

    // Vérifier si l'utilisateur n'a pas déjà un compte existant
    const existingUser = await bdd.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(400).json({ status: 400, message: 'Cet utilisateur possède déjà un compte.' });
      return;
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
        organizationId,
        inviterId,
        expiresAt,
        status: 'pending',
        createdAt: new Date(),
      },
    });

    // 2. Générer l'URL et le template Mail (Similaire au fonctionnement BetterAuth)
    const invitationLink = `${process.env.API_URL || 'http://localhost:3000'}/register?token=${invitation.id}`;

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

    res.status(201).json({
      status: 201,
      message: 'Invitation générée et envoyée avec succès.',
      data: { invitationId: invitation.id, expiresAt },
    });
  } catch (error) {
    console.error('[InvitationController] Erreur :', error);
    res.status(500).json({ status: 500, message: "Impossible de créer l'invitation interne." });
  }
};
