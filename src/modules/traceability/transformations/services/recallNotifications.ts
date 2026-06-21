import { sendEmail } from '../../../../shared/utils/mailer/mailer';
import { escapeHtml } from '../../../../shared/utils/html/escapeHtml';
import { logger } from '../../../../shared/utils/logger/logger';

/**
 * Cible de notification d'un client externe lors d'un rappel.
 * Interface minimale (ISP) : `AffectedShipment` la satisfait structurellement, sans couplage.
 */
export interface RecallCustomerTarget {
  customerEmail: string | null;
  customerName: string;
  shipmentRef: string;
  batchIds: string[];
}

/**
 * Notifie par email les clients externes dont une expédition contient un lot rappelé
 * (Objectif SMART n°5 : cascade de notification, jusqu'ici manuelle — cf. docs/12, P3).
 *
 * Fire-and-forget hors transaction, comme `notifyOrgAdmins` : le rappel est déjà persisté,
 * l'envoi ne doit ni le bloquer ni l'annuler. Les clients sans email restent à contacter
 * manuellement (téléphone/adresse, déjà présents dans la réponse HTTP du rappel) — signalé en warning.
 */
export async function notifyRecallCustomers(
  targets: RecallCustomerTarget[],
  batchId: string,
  reason: string
): Promise<void> {
  try {
    const withEmail = targets.filter((t) => t.customerEmail);
    const sansEmail = targets.length - withEmail.length;
    if (sansEmail > 0) {
      logger.warn(
        `[RECALL] ${sansEmail} client(s) sans email → notification manuelle requise (téléphone/adresse).`
      );
    }

    await Promise.all(
      withEmail.map((t) =>
        sendEmail({
          to: t.customerEmail as string,
          subject: '[RAPPEL PRODUIT] Action immédiate requise sur une de vos expéditions',
          html: buildClientRecallEmail(t, reason),
        }).catch((err) =>
          logger.error(
            `[RECALL] échec d'envoi au client ${t.customerName}: ${(err as Error).message}`
          )
        )
      )
    );
  } catch (err) {
    logger.error(
      `[RECALL] échec de notification des clients (lot ${batchId}): ${(err as Error).message}`
    );
  }
}

/**
 * Corps HTML destiné au client. On ne divulgue que le NOMBRE de lots concernés
 * (les identifiants internes ne regardent pas le client). Toute donnée d'origine
 * utilisateur (motif, nom, référence) est échappée (anti-XSS inbox).
 */
function buildClientRecallEmail(target: RecallCustomerTarget, reason: string): string {
  const safeName = escapeHtml(target.customerName);
  const safeRef = escapeHtml(target.shipmentRef);
  const safeReason = escapeHtml(reason);
  return `
    <h2>Rappel produit — action immédiate requise</h2>
    <p>Bonjour ${safeName},</p>
    <p>Un rappel produit a été déclenché. Votre expédition <strong>${safeRef}</strong> contient
       <strong>${target.batchIds.length}</strong> lot(s) concerné(s).</p>
    <p>Motif : ${safeReason}</p>
    <p>Merci de cesser immédiatement toute distribution ou vente des produits concernés
       et de prendre contact avec nous pour la procédure de retour.</p>
  `;
}
