import { prisma } from '../../../../shared/configs/prismaClient.config';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';
import { gs1Utils } from '../../shared/utils/gs1.utils';

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
      // 0. Génération automatique de l'identifiant si demandé (Standard SSCC)
      let finalShipmentId = data.shipment_id;
      if (finalShipmentId === 'AUTO' || !finalShipmentId) {
        const count = await tx.shipment.count({ where: { organization_id: data.organization_id } });
        finalShipmentId = gs1Utils.generateSSCC(count + 1);
      }

      // 1. Créer l'entête de l'expédition
      const shipment = await tx.shipment.create({
        data: {
          organization_id: data.organization_id,
          id_client: data.id_client,
          shipment_id: finalShipmentId,
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

        // 3. Validation des règles métier (Qualité & Date)
        if (batch.statut === 'NON_CONFORME') {
          throw new APIError(400, {
            error: [
              {
                field: 'lots',
                message: `Le lot ${item.id_lot} est marqué NON_CONFORME et ne peut être expédié.`,
              },
            ],
          });
        }

        if (batch.date_peremption && batch.date_peremption < new Date()) {
          throw new APIError(400, {
            error: [{ field: 'lots', message: `Le lot ${item.id_lot} est périmé.` }],
          });
        }

        if (batch.quantite_actuelle.toNumber() < item.quantite) {
          throw new APIError(400, {
            error: [{ field: 'lots', message: `Stock insuffisant pour le lot ${item.id_lot}.` }],
          });
        }

        // 4. Déduire le stock
        await tx.batch.update({
          where: { id: item.id_lot },
          data: {
            quantite_actuelle: { decrement: item.quantite },
            statut: batch.quantite_actuelle.toNumber() === item.quantite ? 'EXPEDIE' : 'EN_STOCK',
          },
        });

        // 5. Créer la liaison
        await tx.liaison_Shipment.create({
          data: {
            id_expedition: shipment.id,
            id_lot: item.id_lot,
            quantite_expediee: item.quantite,
            unite: batch.unite_code,
          },
        });

        // 6. Enregistrer le mouvement (Audit-Trail)
        await tx.batch_Mouvement.create({
          data: {
            id_lot: item.id_lot,
            type_action: 'EXPEDITION',
            quantite: item.quantite,
            unite: batch.unite_code,
            id_expedition: shipment.id,
            id_user: data.created_by,
          },
        });
      }

      return shipment;
    });
  },
};
