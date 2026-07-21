import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../configs/prismaClient.config', () => ({
  prisma: { iotGateway: { findFirst: vi.fn() } },
}));

import { hashGatewayKey, resolveGatewayOrg } from './iotGateway';
import { prisma } from '../../configs/prismaClient.config';

describe('iotGateway', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ne stocke jamais la clé en clair', () => {
    const empreinte = hashGatewayKey('cle-passerelle');

    expect(empreinte).not.toContain('cle-passerelle');
    expect(empreinte).toMatch(/^[0-9a-f]{64}$/);
    expect(hashGatewayKey('cle-passerelle')).toBe(empreinte);
  });

  it("cherche l'empreinte, jamais la clé, et ignore les passerelles révoquées", async () => {
    vi.mocked(prisma.iotGateway.findFirst).mockResolvedValue({
      organization_id: 'org-b',
    } as never);

    const org = await resolveGatewayOrg('cle-passerelle');

    expect(org).toBe('org-b');
    expect(prisma.iotGateway.findFirst).toHaveBeenCalledWith({
      where: { key_hash: hashGatewayKey('cle-passerelle'), revoked_at: null },
      select: { organization_id: true },
    });
  });

  it('renvoie null quand aucune passerelle active ne porte cette clé', async () => {
    vi.mocked(prisma.iotGateway.findFirst).mockResolvedValue(null as never);

    await expect(resolveGatewayOrg('inconnue')).resolves.toBeNull();
  });
});
