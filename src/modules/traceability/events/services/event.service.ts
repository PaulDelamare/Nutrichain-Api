import { prisma } from '../../../../shared/configs/prismaClient.config';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

export interface ListEventsFilters {
  eventType?: string;
  relatedEntity?: string;
}

/**
 * Service de restitution des événements EPCIS (interopérabilité GS1).
 * Toutes les lectures sont cloisonnées par organisation (multi-tenant).
 */
export const eventService = {
  async listEvents(
    activeOrgId: string | undefined,
    page = 1,
    limit = 20,
    filters: ListEventsFilters = {}
  ) {
    // Garde multi-tenant : sans org, Prisma ignorerait le filtre et fuiterait les autres organisations
    if (!activeOrgId) {
      throw new APIError(401, {
        error: [{ field: 'auth', message: 'Organisation non identifiée.' }],
      });
    }

    // Défense en profondeur : la validation VineJS borne déjà l'entrée HTTP, mais le service
    // garantit aussi des arguments Prisma sûrs (entiers, plafond 500) s'il est appelé autrement.
    const safePage = Number.isFinite(page) && page > 0 ? Math.trunc(page) : 1;
    const safeLimit = Number.isFinite(limit) && limit > 0 && limit <= 500 ? Math.trunc(limit) : 20;
    const skip = (safePage - 1) * safeLimit;

    const where = {
      organization_id: activeOrgId,
      ...(filters.eventType ? { event_type: filters.eventType } : {}),
      ...(filters.relatedEntity ? { related_entity: filters.relatedEntity } : {}),
    };

    const [total, events] = await prisma.$transaction([
      prisma.ePCIS_Event.count({ where }),
      prisma.ePCIS_Event.findMany({
        where,
        orderBy: { event_time: 'desc' },
        skip,
        take: safeLimit,
      }),
    ]);

    return {
      data: events,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  },
};
