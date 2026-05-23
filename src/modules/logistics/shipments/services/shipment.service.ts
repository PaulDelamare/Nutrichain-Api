import { prisma } from '../../../../shared/configs/prismaClient.config';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

/**
 * Service pour la gestion des Expéditions (Shipments)
 */
export const shipmentService = {
  /**
   * Créer une expédition et déduire les stocks des lots associés.
   */
  async createShipment(data: {
    organization_id: string;
    id_client: string;
    shipment_id: string;
    transporteur: string;
    date_envoi: Date;
    created_by: string;
    items: Array<{ id_lot: string; quantite: number }>;
  }) {
    return await prisma.$transaction(async (tx) => {
      // 1. Créer l'entête de l'expédition
      const shipment = await tx.shipment.create({
        data: {
          organization_id: data.organization_id,
          id_client: data.id_client,
          shipment_id: data.shipment_id,
          transporteur: data.transporteur,
          date_envoi: data.date_envoi,
          statut_livraison: 'EN_ROUTE',
          created_by: data.created_by,
        },
      });

      // 2. Traiter chaque lot (Déduction de stock + Liaison)
      for (const item of data.items) {
        const batch = await tx.batch.findFirst({
          where: {
            id: item.id_lot,
            organization_id: data.organization_id,
          },
        });

        if (!batch) {
          throw new APIError(404, {
            error: [{ field: 'lots', message: `Lot ${item.id_lot} introuvable ou accès refusé.` }],
          });
        }

        if (batch.quantite_actuelle.toNumber() < item.quantite) {
          throw new APIError(400, {
            error: [{ field: 'lots', message: `Stock insuffisant pour le lot ${item.id_lot}.` }],
          });
        }

        // Déduire le stock
        await tx.batch.update({
          where: { id: item.id_lot },
          data: {
            quantite_actuelle: { decrement: item.quantite },
            statut: batch.quantite_actuelle.toNumber() === item.quantite ? 'EXPEDIE' : 'EN_STOCK',
          },
        });

        // Créer la liaison (Si la table existe dans le schéma)
        await tx.liaison_Shipment.create({
          data: {
            id_shipment: shipment.id,
            id_lot: item.id_lot,
            quantite_liee: item.quantite,
          },
        });
      }

      return shipment;
    });
  },
};
