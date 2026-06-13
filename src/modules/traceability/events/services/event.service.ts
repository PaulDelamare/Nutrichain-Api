import { prisma } from '../../../../shared/configs/prismaClient.config';

export interface ListEventsFilters {
  eventType?: string;
  relatedEntity?: string;
}

/**
 * Service de restitution des événements EPCIS (interopérabilité GS1).
 * Toutes les lectures sont cloisonnées par organisation (multi-tenant).
 */
export const eventService = {
  async listEvents(activeOrgId: string, page = 1, limit = 20, filters: ListEventsFilters = {}) {
    const safePage = page > 0 ? page : 1;
    const safeLimit = limit > 0 && limit <= 500 ? limit : 20;
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
