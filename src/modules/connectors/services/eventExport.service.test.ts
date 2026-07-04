import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: { ePCIS_Event: { findMany: vi.fn() } },
}));

import { eventExportService } from './eventExport.service';
import { prisma } from '../../../shared/configs/prismaClient.config';

const orgId = 'org-1';

describe('eventExportService.exportEventsCsv', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exporte les événements en CSV (en-tête + payload sérialisé), cloisonné par org', async () => {
    vi.mocked(prisma.ePCIS_Event.findMany).mockResolvedValue([
      {
        event_time: new Date('2026-06-20T10:00:00.000Z'),
        event_type: 'ObjectEvent',
        related_entity: 'Receipt',
        related_id: 'rec-1',
        payload: {
          quantityList: [{ epcClass: 'urn:epc:class:lgtin:3456789.001234.260704-ABC123' }],
          bizStep: 'receiving',
        },
      },
    ] as never);

    const csv = await eventExportService.exportEventsCsv(orgId);
    const lines = csv.split('\r\n');

    expect(lines[0]).toBe('event_time,event_type,related_entity,related_id,payload');
    expect(lines[1]).toContain('2026-06-20T10:00:00.000Z,ObjectEvent,Receipt,rec-1,');
    expect(lines[1]).toContain('quantityList'); // payload JSON présent
    // cloisonnement multi-tenant
    expect(prisma.ePCIS_Event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organization_id: orgId } })
    );
  });

  it('renvoie uniquement l en-tête si aucun événement', async () => {
    vi.mocked(prisma.ePCIS_Event.findMany).mockResolvedValue([] as never);

    const csv = await eventExportService.exportEventsCsv(orgId);

    expect(csv).toBe('event_time,event_type,related_entity,related_id,payload');
  });
});
