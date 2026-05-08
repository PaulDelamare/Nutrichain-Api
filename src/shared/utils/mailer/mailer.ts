import { logger } from '../../../shared/utils/logger/logger';
import nodemailer from 'nodemailer';

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
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER || 'user',
    pass: process.env.SMTP_PASS || 'pass',
  },
});

/**
 * Service d'envoi d'e-mail.
 *
 * @param options SendEmailOptions
 * @returns Promise<void>
 */
export const sendEmail = async (options: SendEmailOptions): Promise<void> => {
  try {
    logger.info(`[MailerService] Préparation de l'e-mail pour: ${options.to}`);

    // Vérification de la configuration avant l'envoi
    await transporter.verify();
    logger.info('[MailerService] Connexion au serveur SMTP réussie.');

    const mailOptions = {
      from: process.env.SMTP_FROM || '"NutriChain APP" <no-reply@nutrichain.com>',
      to: options.to,
      subject: options.subject,
      text: options.text || options.html.replace(/<[^>]*>?/gm, ''), // Fallback basique HTML -> Texte brut
      html: options.html,
    };

    logger.info("[MailerService] Options configurées, tentative d'envoi...");
    const info = await transporter.sendMail(mailOptions);
    logger.info(`[MailerService] E-mail envoyé avec succès. MessageId: ${info.messageId}`);

    // Affichage local Ethereal Email :
    if (process.env.NODE_ENV !== 'production' || process.env.SMTP_HOST?.includes('ethereal')) {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      // On le log si c'est ethereal (un FAUX smtp de test utile pendant le dev)
      if (previewUrl) {
        logger.info(`📧 [E-mail envoyé] Prévisualisation disponible: ${previewUrl}`);
      } else {
        logger.info(
          '⚠️ Ethereal détecté mais impossible de générer un lien de prévisualisation (previewUrl null).'
        );
      }
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.error(`[MailerService Error] ${error.message}`);
    } else {
      logger.error(`[MailerService Error] Une erreur inconnue est survenue: ${String(error)}`);
    }

    // On relance l'erreur pour que l'appelant (le middleware ou BetterAuth) puisse la gérer
    // eslint-disable-next-line preserve-caught-error
    throw new Error("L'envoi de l'e-mail a échoué.");
  }
};
