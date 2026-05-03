import nodemailer from "nodemailer";

/**
 * Typage strict des options d'envoi d'e-mail.
 */
export interface SendEmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

/**
 * Transporteur Nodemailer basé sur les variables d'environnement.
 */
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.ethereal.email",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER || "user",
        pass: process.env.SMTP_PASS || "pass",
    },
});

/**
 * Service d'envoi d'e-mail super simple et parfaitement typé.
 * Utilisable en une seule ligne : `await sendEmail({ to: "...", subject: "...", html: "..." })`
 * 
 * @param options SendEmailOptions
 * @returns Promise<void>
 */
export const sendEmail = async (options: SendEmailOptions): Promise<void> => {
    try {
        const mailOptions = {
            from: process.env.SMTP_FROM || '"NutriChain APP" <no-reply@nutrichain.com>',
            to: options.to,
            subject: options.subject,
            text: options.text || options.html.replace(/<[^>]*>?/gm, ""), // Fallback basique HTML -> Texte brut
            html: options.html,
        };

        const info = await transporter.sendMail(mailOptions);
        
        // Uniquement utile en mode de développement avec Ethereal Email :
        if (process.env.NODE_ENV !== "production") {
            const previewUrl = nodemailer.getTestMessageUrl(info);
            // On le log si c'est ethereal (un FAUX smtp de test utile pendant le dev)
            if (previewUrl) {
                console.log(`📧 [E-mail envoyé] Prévisualisation disponible: ${previewUrl}`);
            }
        }
    } catch (error: unknown) {
        if (error instanceof Error) {
            console.error(`[MailerService Error] ${error.message}`);
        } else {
            console.error("[MailerService Error] Une erreur inconnue est survenue.", error);
        }
        
        // On relance l'erreur pour que l'appelant (le middleware ou BetterAuth) puisse la gérer
        throw new Error("L'envoi de l'e-mail a échoué.");
    }
};