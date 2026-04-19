import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { createAuthMiddleware } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { PrismaClient } from "@prisma/client";
import { organization, twoFactor, bearer } from "better-auth/plugins";
import { sendEmail } from "../../shared/utils/mailer/mailer";
import { render } from "@react-email/render";
import { InvitationEmail } from "../../shared/utils/mailer/templates/InvitationEmail";
import { ResetPasswordEmail } from "../../shared/utils/mailer/templates/ResetPasswordEmail";
import React from "react";

const prisma = new PrismaClient();

export const auth = betterAuth({
    baseURL: process.env.API_URL || "http://localhost:3000",
    // 🛡️ Permet d'accepter les requêtes d'API externes (Postman, Bruno, et IoT) qui n'ont pas pu générer automatiquement d'Origin via un navigateur Moteur.
    advanced: {
        crossSubDomainCookies: {
            enabled: true
        }
    },
    // Hook pour intercepter et traduire/formater nativement les erreurs de BetterAuth
    hooks: {
        after: createAuthMiddleware(async (ctx) => {
            const error = ctx.context.returned;

            // Si le retour est une erreur API, on peut la traduire
            if (error instanceof APIError) {
                let message = error.message;

                if (error.body?.code === "INVALID_EMAIL_OR_PASSWORD") {
                    message = "L'adresse e-mail ou le mot de passe est incorrect.";
                } else if (error.body?.code === "USER_NOT_FOUND") {
                    message = "Aucun utilisateur trouvé avec cette adresse e-mail.";
                }

                // Transforme l'erreur native de Better-Auth vers notre format standard ({ status, error: [{field, message}] })
                // Même si ça reste une classe APIError, ce format sera renvoyé au client !
                throw new APIError(error.status, {
                    status: error.statusCode || 401,
                    error: [{ field: "auth", message }]
                } as any);
            }
        })
    },
    database: prismaAdapter(prisma, {
        provider: "postgresql",
    }),
    emailAndPassword: {
        enabled: true,
        sendResetPassword: async ({ user, url }): Promise<void> => {
            const htmlBody = await render(
               React.createElement(ResetPasswordEmail, { name: user.name, resetLink: url })
            );

            await sendEmail({
                to: user.email,
                subject: "NutriChain - R�initialisation du mot de passe",
                html: htmlBody
            });
        },
    },
    plugins: [
        organization({
            sendInvitationEmail: async (data): Promise<void> => {
                const invitationLink = `${process.env.API_URL || "http://localhost:3000"}/front-end-acceptation-page?token=${data.id}`;

                const htmlBody = await render(
                   React.createElement(InvitationEmail, {
                       email: data.email,
                       role: data.role,
                       invitationLink,
                       inviterName: data.inviter.user.name // On utilise data.inviter.user fourni par BetterAuth
                   })
                );

                await sendEmail({
                    to: data.email,
                    subject: `Rejoignez l'organisation : NutriChain`,
                    html: htmlBody
                });
            }
        }),
        twoFactor(),
        bearer(),
    ],
});

export default auth;
