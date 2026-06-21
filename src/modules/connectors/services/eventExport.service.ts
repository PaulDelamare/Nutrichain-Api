import { prisma } from '../../../shared/configs/prismaClient.config';
import { toCsv } from '../../../shared/utils/csv/csv';

const EVENT_EXPORT_COLUMNS = [
  'event_time',
  'event_type',
  'related_entity',
  'related_id',
  'payload',
];

// Garde-fou volumétrie sur l'export (connecteur sortant).
const EVENT_EXPORT_LIMIT = 10000;

export const eventExportService = {
  /**
   * Exporte les événements EPCIS de l'organisation en CSV (connecteur ERP/WMS sortant).
   * Le `payload` (JSON hétérogène selon le type d'event) est sérialisé dans une colonne dédiée
   * (export sans perte). Strictement cloisonné à l'organisation active.
   */
  async exportEventsCsv(organizationId: string): Promise<string> {
    const events = await prisma.ePCIS_Event.findMany({
      where: { organization_id: organizationId },
      orderBy: { event_time: 'desc' },
      take: EVENT_EXPORT_LIMIT,
    });

    if (events.length === 0) {
      return EVENT_EXPORT_COLUMNS.join(',');
    }

    const rows = events.map((e) => ({
      event_time: e.event_time.toISOString(),
      event_type: e.event_type,
      related_entity: e.related_entity,
      related_id: e.related_id,
      payload: JSON.stringify(e.payload),
    }));

    return toCsv(rows, EVENT_EXPORT_COLUMNS);
  },
};
