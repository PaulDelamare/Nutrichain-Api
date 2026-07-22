import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../shared/utils/audit/audit.service';
import { retryableTransaction } from '../../../shared/utils/db/withWriteConflictRetry';

export interface LocationInput {
  nom: string;
  type: string;
  description?: string;
}

const introuvable = () =>
  new APIError(404, {
    error: [{ field: 'id', message: 'Emplacement introuvable ou accès refusé.' }],
  });

// La lecture (liste) vit dans `equipmentService.listLocations`, enrichie du filtre `is_active`.
export const locationService = {
  async create(input: LocationInput, organizationId: string, actorUserId: string) {
    // Écriture et audit dans une SEULE transaction : une donnée de référence ne doit jamais
    // exister sans sa trace WORM, ni une trace désigner une entité qui n'existe pas.
    return retryableTransaction(async (tx) => {
      const location = await tx.location.create({
        data: { ...input, organization_id: organizationId },
      });

      await auditService.logAction(
        {
          organizationId,
          userId: actorUserId,
          action: 'CREATE_LOCATION',
          entity: 'Location',
          entityId: location.id,
          newValue: location as unknown as Record<string, unknown>,
        },
        tx
      );

      return location;
    });
  },

  async update(
    id: string,
    input: Partial<LocationInput>,
    organizationId: string,
    actorUserId: string
  ) {
    // La LECTURE est dans la transaction : l'état journalisé est celui sur lequel l'écriture a
    // porté, et un échec de l'audit annule la modification. (Ce n'est pas un verrou : en Read
    // Committed, la ligne n'est pas figée entre le `findFirst` et l'`update`.)
    return retryableTransaction(async (tx) => {
      const existant = await tx.location.findFirst({
        where: { id, organization_id: organizationId },
      });
      if (!existant) throw introuvable();

      const location = await tx.location.update({ where: { id }, data: input });

      await auditService.logAction(
        {
          organizationId,
          userId: actorUserId,
          action: 'UPDATE_LOCATION',
          entity: 'Location',
          entityId: id,
          oldValue: existant as unknown as Record<string, unknown>,
          newValue: location as unknown as Record<string, unknown>,
        },
        tx
      );

      return location;
    });
  },

  /**
   * Archive ou réactive. Un lieu archivé n'apparaît plus pour la création de matériel (garde dans
   * equipment.service). Le matériel DÉJÀ placé dans ce lieu continue de fonctionner : on n'invalide
   * pas l'existant, on empêche seulement d'en ajouter. On ne supprime jamais (FK Restrict).
   */
  async setActive(id: string, active: boolean, organizationId: string, actorUserId: string) {
    return retryableTransaction(async (tx) => {
      const existant = await tx.location.findFirst({
        where: { id, organization_id: organizationId },
      });
      if (!existant) throw introuvable();

      // Idempotent : ne pas rejouer l'action dans l'audit si l'état ne change pas.
      if (existant.is_active === active) return existant;

      const location = await tx.location.update({ where: { id }, data: { is_active: active } });

      await auditService.logAction(
        {
          organizationId,
          userId: actorUserId,
          action: active ? 'REACTIVATE_LOCATION' : 'ARCHIVE_LOCATION',
          entity: 'Location',
          entityId: id,
        },
        tx
      );

      return location;
    });
  },
};
