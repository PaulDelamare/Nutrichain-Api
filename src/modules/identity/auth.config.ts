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
import crypto from "crypto";

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
                // @ts-expect-error Types internes Better-Auth incomplets
                let message: string = error.message || "Erreur d'authentification";

                // @ts-expect-error Types internes Better-Auth incomplets
                const errCode = error.body?.code;

                if (errCode === "INVALID_EMAIL_OR_PASSWORD") {
                    message = "L'adresse e-mail ou le mot de passe est incorrect.";
                } else if (errCode === "USER_NOT_FOUND" || errCode === "email_not_found") {
                    message = "Aucun utilisateur trouvé avec cette adresse e-mail.";
                }

                // @ts-expect-error Types internes Better-Auth incomplets
                const sendStatus = error.statusCode || 401;

                // Transforme l'erreur native de Better-Auth vers notre format standard ({ status, error: [{field, message}] })
                throw new APIError("UNAUTHORIZED", {
                    status: sendStatus,
                    error: [{ field: "auth", message }]
                });
            }
        })
    },
    database: prismaAdapter(prisma, {
        provider: "postgresql",
    }),
    databaseHooks: {
        user: {
            create: {
                // Intercepte silencieusement APRÈS la création d'un utilisateur
                after: async (user) => {
                    // Trouver si cet utilisateur avait une invitation en attente
                    const invitation = await prisma.invitation.findFirst({
                        where: { email: user.email, status: "pending" }
                    });

                    if (invitation) {
                        try {
                            // On la marque comme acceptée : le token est brulé
                            await prisma.invitation.update({
                                where: { id: invitation.id },
                                data: { status: "accepted" }
                            });

                            // Association Automatique de l'utilisateur à l'Organisation de l'invitation
                            await prisma.member.create({
                                data: {
                                    id: crypto.randomUUID(), // fake id, prisma might need string or uuid
                                    organizationId: invitation.organizationId,
                                    userId: user.id,
                                    role: invitation.role || "member",
                                    createdAt: new Date()
                                }
                            });
                            console.log(`[BetterAuth Hook] Invitation acceptée et Membre généré pour l'utilisateur: ${user.email}`);
                        } catch (e) {
                            console.error("[BetterAuth Hook] Erreur lors de la consommation de l'invitation:", e);
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
                                    name: "Siège Central NutriChain",
                                    slug: "siege-central",
                                    createdAt: new Date(),
                                    metadata: "{}" // Champ obligatoire si requis par Prisma
                                }
                            });
                            
                            await prisma.member.create({
                                data: {
                                    id: crypto.randomUUID(),
                                    organizationId: newOrgId,
                                    userId: user.id,
                                    role: "owner", // Le super-admin initial est 'owner'
                                    createdAt: new Date()
                                }
                            });
                            console.log(`[BetterAuth Hook] Premier utilisateur détecté : Zone 'Siège Central' créée pour ${user.email}`);
                        } catch (e) {
                            console.error("[BetterAuth Hook] Erreur lors de la création de la zone initiale:", e);
                        }
                    }
                }
            }
        }
    },
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
