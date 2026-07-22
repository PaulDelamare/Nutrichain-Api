import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../shared/utils/audit/audit.service';
import { retryableTransaction } from '../../../shared/utils/db/withWriteConflictRetry';

export interface CustomerInput {
  nom_enseigne: string;
  adresse_livraison: string;
  contact_urgence?: string;
  email?: string;
  notes?: string;
}

const introuvable = () =>
  new APIError(404, {
    error: [{ field: 'id', message: 'Client introuvable ou accès refusé.' }],
  });

// La lecture (liste) vit dans `organizationService.listCustomers`, enrichie du filtre `is_active`.
export const customerService = {
  async create(input: CustomerInput, organizationId: string, actorUserId: string) {
    // Écriture et audit dans une SEULE transaction : une donnée de référence ne doit jamais
    // exister sans sa trace WORM, ni une trace désigner une entité qui n'existe pas.
    return retryableTransaction(async (tx) => {
      const customer = await tx.customer.create({
        data: { ...input, organization_id: organizationId },
      });

      await auditService.logAction(
        {
          organizationId,
          userId: actorUserId,
          action: 'CREATE_CUSTOMER',
          entity: 'Customer',
          entityId: customer.id,
          newValue: customer as unknown as Record<string, unknown>,
        },
        tx
      );

      return customer;
    });
  },

  async update(
    id: string,
    input: Partial<CustomerInput>,
    organizationId: string,
    actorUserId: string
  ) {
    // La LECTURE est dans la transaction : l'état journalisé est celui sur lequel l'écriture a
    // porté, et un échec de l'audit annule la modification. (Ce n'est pas un verrou : en Read
    // Committed, la ligne n'est pas figée entre le `findFirst` et l'`update`.)
    return retryableTransaction(async (tx) => {
      const existant = await tx.customer.findFirst({
        where: { id, organization_id: organizationId },
      });
      if (!existant) throw introuvable();

      const customer = await tx.customer.update({ where: { id }, data: input });

      await auditService.logAction(
        {
          organizationId,
          userId: actorUserId,
          action: 'UPDATE_CUSTOMER',
          entity: 'Customer',
          entityId: id,
          oldValue: existant as unknown as Record<string, unknown>,
          newValue: customer as unknown as Record<string, unknown>,
        },
        tx
      );

      return customer;
    });
  },

  /**
   * Archive ou réactive. Un client archivé disparaît des sélections ET ne peut plus recevoir
   * d'expédition (garde dans shipment.service). On ne supprime jamais : des expéditions passées le
   * référencent, et le rappel produit doit pouvoir remonter jusqu'à lui.
   */
  async setActive(id: string, active: boolean, organizationId: string, actorUserId: string) {
    return retryableTransaction(async (tx) => {
      const existant = await tx.customer.findFirst({
        where: { id, organization_id: organizationId },
      });
      if (!existant) throw introuvable();

      if (existant.is_active === active) return existant;

      const customer = await tx.customer.update({ where: { id }, data: { is_active: active } });

      await auditService.logAction(
        {
          organizationId,
          userId: actorUserId,
          action: active ? 'REACTIVATE_CUSTOMER' : 'ARCHIVE_CUSTOMER',
          entity: 'Customer',
          entityId: id,
        },
        tx
      );

      return customer;
    });
  },
};
