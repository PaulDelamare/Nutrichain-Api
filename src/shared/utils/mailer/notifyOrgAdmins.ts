import { prisma } from '../../configs/prismaClient.config';
import { sendEmail } from './mailer';
import { logger } from '../logger/logger';

export interface OrgAdminEmail {
  subject: string;
  html: string;
}

/**
 * Notifie par email les membres `owner`/`admin` d'une organisation.
 *
 * Conçu pour un appel fire-and-forget (`void`) hors d'un path critique :
 * l'action métier est déjà persistée, l'envoi ne doit ni bloquer ni faire
 * échouer l'opération. Chaque échec d'envoi est capté individuellement et
 * toute erreur globale (résolution des destinataires) est avalée + loggée.
 */
export async function notifyOrgAdmins(organizationId: string, email: OrgAdminEmail): Promise<void> {
  try {
    const recipients = await prisma.member.findMany({
      where: { organizationId, role: { in: ['owner', 'admin'] } },
      include: { user: { select: { email: true, name: true } } },
    });

    await Promise.all(
      recipients.map((r) =>
        sendEmail({ to: r.user.email, subject: email.subject, html: email.html }).catch((err) => {
          logger.error(
            `[notifyOrgAdmins] échec d'envoi vers ${r.user.email}: ${(err as Error).message}`
          );
        })
      )
    );
  } catch (err) {
    logger.error(
      `[notifyOrgAdmins] échec de notification de l'org ${organizationId}: ${(err as Error).message}`
    );
  }
}
