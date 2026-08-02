import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../../shared/utils/audit/audit.service';
import { retryableTransaction } from '../../../../shared/utils/db/withWriteConflictRetry';
import { MOVEMENT_TYPES, SHIPMENT_DELIVERY_STATUSES } from '../../constants/logistics.constants';

export interface WithdrawalPayload {
  id_client: string;
  quantite: number;
  motif: string;
  constate_aupres_de?: string;
}

export interface WithdrawalResult {
  id: string;
  quantiteLivree: string;
  quantiteRetiree: string;
  resteARetirer: string;
  unite: string;
}

/** Ce qu'un client a reçu, retiré, et ce qu'il lui reste à retirer pour un lot donné. */
export interface CustomerWithdrawalSummary {
  customerId: string;
  customerName: string;
  quantiteLivree: string;
  quantiteRetiree: string;
  resteARetirer: string;
  unite: string;
  retraits: {
    id: string;
    quantite: string;
    motif: string;
    constateAupresDe: string | null;
    createdAt: Date;
  }[];
}

/**
 * Le budget par défaut de Prisma est de 5 s. Le plafond somme deux agrégats et scelle un maillon
 * d'audit : sous rafale, l'attente du verrou peut l'atteindre, et un retrait perdu au timeout est
 * un retrait que le magasin croit avoir déclaré.
 */
const WITHDRAWAL_TX_OPTIONS = {
  timeout: 15000,
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
} as const;

/**
 * Quantité livrée à un client pour un lot — la SEULE base légitime du plafond.
 *
 * Ne somme que les expéditions dont l'arrivée est constatée : compter aussi celles en route
 * autoriserait à déclarer retirée de la marchandise encore dans le camion. `Liaison_Shipment` ne
 * porte pas d'`organization_id`, le cloisonnement passe donc par l'expédition.
 */
async function sumDeliveredToCustomer(
  tx: Prisma.TransactionClient,
  { batchId, organizationId, customerId }: { batchId: string; organizationId: string; customerId: string }
): Promise<Prisma.Decimal> {
  const delivered = await tx.liaison_Shipment.aggregate({
    _sum: { quantite_expediee: true },
    where: {
      id_lot: batchId,
      expedition: {
        organization_id: organizationId,
        id_client: customerId,
        statut_livraison: SHIPMENT_DELIVERY_STATUSES.DELIVERED,
      },
    },
  });

  return delivered._sum.quantite_expediee ?? new Prisma.Decimal(0);
}

async function sumAlreadyWithdrawn(
  tx: Prisma.TransactionClient,
  { batchId, organizationId, customerId }: { batchId: string; organizationId: string; customerId: string }
): Promise<Prisma.Decimal> {
  const withdrawn = await tx.withdrawal.aggregate({
    _sum: { quantite: true },
    where: { organization_id: organizationId, id_lot: batchId, id_client: customerId },
  });

  return withdrawn._sum.quantite ?? new Prisma.Decimal(0);
}

export const withdrawalService = {
  /**
   * Enregistre le retrait d'un lot du rayon d'un magasin.
   *
   * Distinct de la mise au rebut : détruire à l'usine et retirer du rayon ne sont pas le même geste.
   * Le statut du lot n'est donc PAS modifié — un lot sous rappel le reste, et un lot déjà au rebut
   * accepte quand même le retrait, parce que les deux se produisent normalement ensemble : on
   * détruit ce qui reste à l'usine pendant que les magasins vident leurs rayons.
   *
   * La clé est (client, lot), jamais la ligne d'expédition : l'étiquette n'encode que le produit et
   * le lot, donc le magasin qui scanne ignore de quelle livraison vient la marchandise.
   */
  async recordWithdrawal(
    batchId: string,
    organizationId: string,
    userId: string,
    payload: WithdrawalPayload
  ): Promise<WithdrawalResult> {
    return retryableTransaction(async (tx) => {
      const batch = await tx.batch.findFirst({
        where: { id: batchId, organization_id: organizationId },
        select: { id: true, unite_code: true },
      });

      if (!batch) {
        throw new APIError(404, {
          error: [{ field: 'batch', message: 'Lot introuvable dans cette organisation.' }],
        });
      }

      // Un client archivé garde ses retraits : la marchandise est partie avant l'archivage, et
      // refuser ici empêcherait de clore un rappel sur un client avec qui on a cessé de travailler.
      const customer = await tx.customer.findFirst({
        where: { id: payload.id_client, organization_id: organizationId },
        select: { id: true },
      });

      if (!customer) {
        throw new APIError(404, {
          error: [{ field: 'id_client', message: 'Client introuvable dans cette organisation.' }],
        });
      }

      const cle = { batchId, organizationId, customerId: payload.id_client };
      const livree = await sumDeliveredToCustomer(tx, cle);

      if (livree.isZero()) {
        throw new APIError(409, {
          error: [
            {
              field: 'id_client',
              message:
                "Aucune livraison constatée de ce lot vers ce client : il n'y a rien à retirer. Confirmez d'abord l'arrivée de l'expédition.",
            },
          ],
        });
      }

      const dejaRetiree = await sumAlreadyWithdrawn(tx, cle);
      // Comparaison en Decimal : en nombre JS, 40 - 30.1 - 9.9 vaut -1.77e-15 et le dernier retrait
      // légitime serait refusé.
      const quantite = new Prisma.Decimal(payload.quantite);
      const cumul = dejaRetiree.plus(quantite);

      if (cumul.greaterThan(livree)) {
        throw new APIError(409, {
          error: [
            {
              field: 'quantite',
              message: `Retrait supérieur à ce qui a été livré à ce client : ${livree.toString()} ${batch.unite_code} livré(s), ${dejaRetiree.toString()} déjà retiré(s).`,
            },
          ],
        });
      }

      const withdrawal = await tx.withdrawal.create({
        data: {
          organization_id: organizationId,
          id_client: payload.id_client,
          id_lot: batchId,
          quantite,
          // Reprise du lot, jamais du corps : la ligne d'expédition n'a jamais d'autre unité.
          unite: batch.unite_code,
          motif: payload.motif,
          retire_par: userId,
          constate_aupres_de: payload.constate_aupres_de ?? null,
        },
        select: { id: true },
      });

      await tx.batch_Mouvement.create({
        data: {
          id_lot: batchId,
          type_action: MOVEMENT_TYPES.SHELF_WITHDRAWAL,
          quantite,
          unite: batch.unite_code,
          id_user: userId,
          metadata: {
            id_client: payload.id_client,
            motif: payload.motif,
            ...(payload.constate_aupres_de
              ? { constate_aupres_de: payload.constate_aupres_de }
              : {}),
          },
        },
      });

      await auditService.logAction(
        {
          organizationId,
          userId,
          action: 'BATCH_WITHDRAWN_FROM_SHELF',
          entity: 'Withdrawal',
          entityId: withdrawal.id,
          newValue: {
            id_lot: batchId,
            id_client: payload.id_client,
            quantite: quantite.toString(),
            unite: batch.unite_code,
            motif: payload.motif,
            constate_aupres_de: payload.constate_aupres_de ?? null,
          },
        },
        tx
      );

      return {
        id: withdrawal.id,
        quantiteLivree: livree.toString(),
        quantiteRetiree: cumul.toString(),
        resteARetirer: livree.minus(cumul).toString(),
        unite: batch.unite_code,
      };
    }, WITHDRAWAL_TX_OPTIONS);
  },

  /**
   * Avancement du retrait d'un lot, par client.
   *
   * Le reste-à-retirer est calculé ICI, avec la règle qui gouverne l'écriture : le laisser à
   * l'écran obligerait chaque client à recopier l'invariant, donc à en diverger.
   */
  async listWithdrawalsByCustomer(
    batchId: string,
    organizationId: string
  ): Promise<CustomerWithdrawalSummary[]> {
    const batch = await prisma.batch.findFirst({
      where: { id: batchId, organization_id: organizationId },
      select: { id: true, unite_code: true },
    });

    if (!batch) {
      throw new APIError(404, {
        error: [{ field: 'batch', message: 'Lot introuvable dans cette organisation.' }],
      });
    }

    const liaisons = await prisma.liaison_Shipment.findMany({
      where: {
        id_lot: batchId,
        expedition: {
          organization_id: organizationId,
          statut_livraison: SHIPMENT_DELIVERY_STATUSES.DELIVERED,
        },
      },
      select: {
        quantite_expediee: true,
        expedition: { select: { id_client: true, client: { select: { nom_enseigne: true } } } },
      },
      orderBy: { id: 'asc' },
    });

    const retraits = await prisma.withdrawal.findMany({
      where: { organization_id: organizationId, id_lot: batchId },
      select: {
        id: true,
        id_client: true,
        quantite: true,
        motif: true,
        constate_aupres_de: true,
        created_at: true,
      },
      orderBy: { created_at: 'asc' },
    });

    const parClient = new Map<string, CustomerWithdrawalSummary>();

    for (const liaison of liaisons) {
      const id = liaison.expedition.id_client;
      const existant = parClient.get(id);

      if (existant) {
        existant.quantiteLivree = new Prisma.Decimal(existant.quantiteLivree)
          .plus(liaison.quantite_expediee)
          .toString();
        continue;
      }

      parClient.set(id, {
        customerId: id,
        customerName: liaison.expedition.client?.nom_enseigne ?? '—',
        quantiteLivree: liaison.quantite_expediee.toString(),
        quantiteRetiree: '0',
        resteARetirer: '0',
        unite: batch.unite_code,
        retraits: [],
      });
    }

    for (const retrait of retraits) {
      const client = parClient.get(retrait.id_client);
      // Un retrait sans livraison constatée ne peut pas exister : l'écriture l'interdit. S'il en
      // apparaissait un, l'ignorer silencieusement masquerait la dérive — on le compte donc.
      if (!client) continue;

      client.quantiteRetiree = new Prisma.Decimal(client.quantiteRetiree)
        .plus(retrait.quantite)
        .toString();
      client.retraits.push({
        id: retrait.id,
        quantite: retrait.quantite.toString(),
        motif: retrait.motif,
        constateAupresDe: retrait.constate_aupres_de,
        createdAt: retrait.created_at,
      });
    }

    return Array.from(parClient.values())
      .map((client) => ({
        ...client,
        resteARetirer: new Prisma.Decimal(client.quantiteLivree)
          .minus(client.quantiteRetiree)
          .toString(),
      }))
      .sort((gauche, droite) => gauche.customerName.localeCompare(droite.customerName));
  },
};
