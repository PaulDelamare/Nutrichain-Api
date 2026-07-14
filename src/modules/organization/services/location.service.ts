import { prisma } from '../../../shared/configs/prismaClient.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { auditService } from '../../../shared/utils/audit/audit.service';

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
    const location = await prisma.location.create({
      data: { ...input, organization_id: organizationId },
    });

    await auditService.logAction({
      organizationId,
      userId: actorUserId,
      action: 'CREATE_LOCATION',
      entity: 'Location',
      entityId: location.id,
      newValue: location as unknown as Record<string, unknown>,
    });

    return location;
  },

  async update(
    id: string,
    input: Partial<LocationInput>,
    organizationId: string,
    actorUserId: string
  ) {
    const existant = await prisma.location.findFirst({
      where: { id, organization_id: organizationId },
    });
    if (!existant) throw introuvable();

    const location = await prisma.location.update({ where: { id }, data: input });

    await auditService.logAction({
      organizationId,
      userId: actorUserId,
      action: 'UPDATE_LOCATION',
      entity: 'Location',
      entityId: id,
      oldValue: existant as unknown as Record<string, unknown>,
      newValue: location as unknown as Record<string, unknown>,
    });

    return location;
  },

  /**
   * Archive ou réactive. Un lieu archivé n'apparaît plus pour la création de matériel (garde dans
   * equipment.service). Le matériel DÉJÀ placé dans ce lieu continue de fonctionner : on n'invalide
   * pas l'existant, on empêche seulement d'en ajouter. On ne supprime jamais (FK Restrict).
   */
  async setActive(id: string, active: boolean, organizationId: string, actorUserId: string) {
    const existant = await prisma.location.findFirst({
      where: { id, organization_id: organizationId },
    });
    if (!existant) throw introuvable();

    // Idempotent : ne pas rejouer l'action dans l'audit si l'état ne change pas.
    if (existant.is_active === active) return existant;

    const location = await prisma.location.update({ where: { id }, data: { is_active: active } });

    await auditService.logAction({
      organizationId,
      userId: actorUserId,
      action: active ? 'REACTIVATE_LOCATION' : 'ARCHIVE_LOCATION',
      entity: 'Location',
      entityId: id,
    });

    return location;
  },
};
