import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../shared/configs/prismaClient.config', () => {
  const prisma = {
    // La transaction est exécutée avec le client lui-même : le test vérifie que l'audit reçoit
    // bien CE client (donc qu'il est scellé dans la même transaction que l'écriture).
    $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    iotGateway: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  return { prisma, bdd: prisma };
});
vi.mock('../../../shared/utils/audit/audit.service', () => ({
  auditService: { logAction: vi.fn() },
}));

import { iotGatewayService } from './iotGateway.service';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { auditService } from '../../../shared/utils/audit/audit.service';
import { hashGatewayKey } from '../../../shared/utils/iotGateway/iotGateway';

describe('iotGatewayService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.iotGateway.create).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (args: any) => ({ id: 'gw-1', nom: args.data.nom, created_at: new Date() }) as any
    );
  });

  it("ne persiste que l'empreinte de la clé, jamais la clé", async () => {
    const gateway = await iotGatewayService.create('Passerelle Nord', 'org-b', 'user-1');

    const persisted = vi.mocked(prisma.iotGateway.create).mock.calls[0][0].data as {
      key_hash: string;
      organization_id: string;
    };
    expect(persisted.key_hash).toBe(hashGatewayKey(gateway.cle));
    expect(JSON.stringify(persisted)).not.toContain(gateway.cle);
    expect(persisted.organization_id).toBe('org-b');
  });

  it('rend une clé imprévisible, et une différente à chaque passerelle', async () => {
    const a = await iotGatewayService.create('A', 'org-b', 'user-1');
    const b = await iotGatewayService.create('B', 'org-b', 'user-1');

    expect(a.cle).not.toBe(b.cle);
    expect(a.cle.length).toBeGreaterThanOrEqual(32);
  });

  it("n'écrit ni la clé ni son empreinte dans le journal d'audit", async () => {
    // Un journal consultable ne doit pas contenir de quoi rejouer une authentification.
    const gateway = await iotGatewayService.create('Passerelle Nord', 'org-b', 'user-1');

    const trace = JSON.stringify(vi.mocked(auditService.logAction).mock.calls[0][0]);
    expect(trace).not.toContain(gateway.cle);
    expect(trace).not.toContain(hashGatewayKey(gateway.cle));
    expect(trace).toContain('CREATE_IOT_GATEWAY');
    // Scellé DANS la transaction : sinon un échec du chaînage WORM laisserait une clé sans trace.
    expect(vi.mocked(auditService.logAction).mock.calls[0][1]).toBeDefined();
  });

  it('ne rend jamais la clé sur la liste (elle n’est affichée qu’une fois)', async () => {
    vi.mocked(prisma.iotGateway.findMany).mockResolvedValue([] as never);

    await iotGatewayService.list('org-b');

    const select = vi.mocked(prisma.iotGateway.findMany).mock.calls[0][0]?.select;
    expect(select).not.toHaveProperty('key_hash');
  });

  it("refuse de révoquer la passerelle d'une autre organisation", async () => {
    vi.mocked(prisma.iotGateway.findFirst).mockResolvedValue(null as never);

    await expect(iotGatewayService.revoke('gw-x', 'org-b', 'user-1')).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.iotGateway.update).not.toHaveBeenCalled();
  });

  it('révoque, et reste idempotent (pas de seconde ligne d’audit)', async () => {
    vi.mocked(prisma.iotGateway.findFirst).mockResolvedValue({
      id: 'gw-1',
      nom: 'Nord',
      revoked_at: null,
    } as never);
    vi.mocked(prisma.iotGateway.update).mockResolvedValue({
      id: 'gw-1',
      nom: 'Nord',
      revoked_at: new Date(),
    } as never);

    await iotGatewayService.revoke('gw-1', 'org-b', 'user-1');
    expect(auditService.logAction).toHaveBeenCalledTimes(1);

    vi.mocked(prisma.iotGateway.findFirst).mockResolvedValue({
      id: 'gw-1',
      nom: 'Nord',
      revoked_at: new Date(),
    } as never);
    await iotGatewayService.revoke('gw-1', 'org-b', 'user-1');

    expect(auditService.logAction).toHaveBeenCalledTimes(1);
    expect(prisma.iotGateway.update).toHaveBeenCalledTimes(1);
  });
});
