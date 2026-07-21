import { logger } from '../../shared/utils/logger/logger';
import { betterAuth } from 'better-auth';
import { APIError as BetterAuthError } from 'better-auth/api';
import { createAuthMiddleware } from 'better-auth/api';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { bdd as prisma } from '../../shared/configs/prismaClient.config';
import { organization, twoFactor, bearer } from 'better-auth/plugins';
import { APIError } from '../../shared/utils/errorHandler/APIError';
import { sendEmail } from '../../shared/utils/mailer/mailer';
import { render } from '@react-email/render';
import { InvitationEmail } from '../../shared/utils/mailer/templates/InvitationEmail';
import { getValidatedInvitationId } from './utils/signupInvitationContext';
import { ResetPasswordEmail } from '../../shared/utils/mailer/templates/ResetPasswordEmail';
import React from 'react';
import crypto from 'crypto';

export const auth = betterAuth({
  baseURL: process.env.API_URL || 'http://localhost:3000',
  // Le front SvelteKit vit sur une autre origine que l'API : sans elle dans
  // trustedOrigins, Better-Auth rejette sign-in/sign-up (« Invalid origin »).
  trustedOrigins: [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    // vite preview (e2e Playwright du front) sert le build sur 4173 — hors production.
    ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:4173'] : []),
  ],
  // 🛡️ Permet d'accepter les requêtes d'API externes (Postman, Bruno, et IoT) qui n'ont pas pu générer automatiquement d'Origin via un navigateur Moteur.
  advanced: {
    // Aligne Better-Auth sur le standard UUID v4 du reste du projet (Prisma @default(uuid)).
    // Sans ça, les routes métier qui valident `vine.string().uuid()` rejettent le user de session.
    generateId: () => crypto.randomUUID(),
    crossSubDomainCookies: {
      enabled: true,
    },
  },
  // Hook pour intercepter et traduire/formater nativement les erreurs de BetterAuth
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      const error = ctx.context.returned;

      // Si le retour est une erreur API, on peut la traduire
      if (error instanceof BetterAuthError) {
        const expectedError = error as Error & { body?: { code?: string }; statusCode?: number };
        let message: string = expectedError.message || "Erreur d'authentification";

        const errCode = expectedError.body?.code;

        if (errCode === 'INVALID_EMAIL_OR_PASSWORD') {
          message = "L'adresse e-mail ou le mot de passe est incorrect.";
        } else if (errCode === 'USER_NOT_FOUND' || errCode === 'email_not_found') {
          message = 'Aucun utilisateur trouvé avec cette adresse e-mail.';
        }

        const sendStatus = expectedError.statusCode || 401;

        // Transforme l'erreur native de Better-Auth vers notre format standard ({ status, error: [{field, message}] })
        throw new APIError(sendStatus, {
          error: [{ field: 'auth', message }],
        });
      }
    }),
  },
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  databaseHooks: {
    session: {
      create: {
        // Sans org active en session, requireOrgRole rejette toutes les routes
        // métier (400) : on résout l'unique organisation du user à la connexion.
        before: async (session) => {
          const membership = await prisma.member.findFirst({
            where: { userId: session.userId },
            select: { organizationId: true },
          });
          return {
            data: { ...session, activeOrganizationId: membership?.organizationId ?? null },
          };
        },
      },
    },
    user: {
      create: {
        // Intercepte silencieusement APRÈS la création d'un utilisateur
        after: async (user) => {
          // L'invitation vient du JETON validé à l'inscription, jamais d'une re-recherche par
          // e-mail : avec deux invitations en attente pour la même adresse, Postgres en rendait une
          // arbitrairement, et l'utilisateur atterrissait dans une organisation qui n'était pas
          // celle de son lien (#95). Le filtre sur `email` reste, en défense en profondeur.
          const validatedInvitationId = getValidatedInvitationId();
          const invitation = validatedInvitationId
            ? await prisma.invitation.findFirst({
                where: { id: validatedInvitationId, email: user.email, status: 'pending' },
              })
            : null;

          // Une inscription passée par le jeton n'est JAMAIS un bootstrap : si l'invitation a été
          // consommée entre-temps, on n'enrôle pas — surtout pas en créant une organisation dont
          // l'utilisateur deviendrait propriétaire.
          if (validatedInvitationId && !invitation) {
            logger.warn(
              `[BetterAuth Hook] Invitation ${validatedInvitationId} introuvable ou déjà consommée — Member non créé pour ${user.email}`
            );
            return;
          }

          if (invitation) {
            try {
              // Consommation atomique : updateMany avec la guard `status='pending'` garantit
              // qu'un seul caller concurrent passe (count===1). Si une autre transaction a
              // déjà consommé l'invitation entre-temps, count===0 et on n'enrôle pas en double.
              const { count } = await prisma.invitation.updateMany({
                where: { id: invitation.id, status: 'pending' },
                data: { status: 'accepted' },
              });

              if (count === 0) {
                logger.warn(
                  `[BetterAuth Hook] Invitation ${invitation.id} déjà consommée — Member non créé pour ${user.email}`
                );
                return;
              }

              // Association Automatique de l'utilisateur à l'Organisation de l'invitation
              await prisma.member.create({
                data: {
                  id: crypto.randomUUID(),
                  organizationId: invitation.organizationId,
                  userId: user.id,
                  role: invitation.role || 'viewer',
                  createdAt: new Date(),
                },
              });
              logger.info(
                `[BetterAuth Hook] Invitation acceptée et Membre généré pour l'utilisateur: ${user.email}`
              );
            } catch (e) {
              logger.error("[BetterAuth Hook] Erreur lors de la consommation de l'invitation:", e);
            }
          } else {
            // RECOMMANDATION 1: Processus du "Premier Utilisateur"
            // Si aucune invitation n'existait, c'est le First Admin (vérifié par guardSignUp).
            // On doit initialiser sa première Zone (Organisation) pour qu'il puisse ensuite inviter des gens.
            try {
              const newOrgId = crypto.randomUUID();
              await prisma.organization.create({
                data: {
                  id: newOrgId,
                  name: 'Siège Central NutriChain',
                  slug: 'siege-central',
                  createdAt: new Date(),
                  metadata: '{}', // Champ obligatoire si requis par Prisma
                },
              });

              await prisma.member.create({
                data: {
                  id: crypto.randomUUID(),
                  organizationId: newOrgId,
                  userId: user.id,
                  role: 'owner', // Le super-admin initial est 'owner'
                  createdAt: new Date(),
                },
              });
              logger.info(
                `[BetterAuth Hook] Premier utilisateur détecté : Zone 'Siège Central' créée pour ${user.email}`
              );
            } catch (e) {
              logger.error('[BetterAuth Hook] Erreur lors de la création de la zone initiale:', e);
            }
          }
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }): Promise<void> => {
      const htmlBody = await render(
        React.createElement(ResetPasswordEmail, { name: user.name, resetLink: url })
      );

      await sendEmail({
        to: user.email,
        subject: 'NutriChain - R�initialisation du mot de passe',
        html: htmlBody,
      });
    },
  },
  plugins: [
    organization({
      // Seconde barrière, derrière `blockOrgPassthrough` : le défaut de Better-Auth est `true`,
      // donc TOUTE session pouvait créer une organisation et s'en faire `owner` — y compris un
      // `viewer` en lecture seule (constaté en HTTP réel). Une organisation naît par le seed ou
      // par une route à nous, gardée et journalisée. Jamais par le plugin.
      allowUserToCreateOrganization: false,
      sendInvitationEmail: async (data): Promise<void> => {
        // Aligné sur le flow custom : on pointe vers la page /inscription du frontend
        // (SvelteKit), pas vers l'API. FRONTEND_URL garanti par assertEnv.
        // Voir docs/16_invitation_register_flow.md.
        const invitationLink = `${process.env.FRONTEND_URL}/inscription?token=${data.id}`;

        const htmlBody = await render(
          React.createElement(InvitationEmail, {
            email: data.email,
            role: data.role,
            invitationLink,
            inviterName: data.inviter.user.name, // On utilise data.inviter.user fourni par BetterAuth
          })
        );

        await sendEmail({
          to: data.email,
          subject: `Rejoignez l'organisation : NutriChain`,
          html: htmlBody,
        });
      },
    }),
    twoFactor(),
    bearer(),
  ],
});

export default auth;
