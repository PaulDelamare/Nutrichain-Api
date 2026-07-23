import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncScansService } from './syncScans.service';
import { receiptService } from '../../logistics/receipts/services/receipt.service';
import { auditService } from '../../../shared/utils/audit/audit.service';
import { prisma } from '../../../shared/configs/prismaClient.config';
import { APIError } from '../../../shared/utils/errorHandler/APIError';
import { ReceiptPayload, SyncItem } from '../types/sync.types';

vi.mock('../../logistics/receipts/services/receipt.service', () => ({
  receiptService: {
    createReceipt: vi.fn(),
  },
}));

vi.mock('../../../shared/utils/audit/audit.service', () => ({
  auditService: {
    logAction: vi.fn(),
  },
}));

// vi.hoisted permet de partager le txClient entre la factory vi.mock (hoisted en haut)
// et les tests qui asserent sur les calls — preuve que receiptService/auditService
// reçoivent EXACTEMENT le tx propagé par $transaction.
const { txClient } = vi.hoisted(() => ({
  txClient: {
    idempotencyKey: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    member: { findFirst: vi.fn() },
  },
}));

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    // Propage les throws de fn pour exercer le catch outer (status: error/conflict)
    $transaction: vi.fn(async (fn, _options) => fn(txClient)),
    idempotencyKey: txClient.idempotencyKey,
    member: txClient.member,
  },
}));

const validReceiptPayload: ReceiptPayload = {
  id_fournisseur: '123e4567-e89b-12d3-a456-426614174000',
  shipment_id: 'SHIP-001',
  id_produit: '123e4567-e89b-12d3-a456-426614174001',
  quantite_actuelle: 100,
  unite_code: 'KG',
  statut_controle: 'OK',
};

const buildItem = (
  clientOpId: string,
  override: Partial<typeof validReceiptPayload> = {}
): SyncItem => ({
  clientOpId,
  type: 'receipt',
  payload: { ...validReceiptPayload, ...override },
});

const okReceipt = { message: 'ok', receiptId: 'rcpt-1', batchId: 'bat-1' };

beforeEach(() => {
  vi.clearAllMocks();
  // Resynchroniser le $transaction (clearAllMocks vide aussi son impl)
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) =>
    (fn as (tx: typeof txClient) => Promise<unknown>)(txClient)
  );
  vi.mocked(prisma.idempotencyKey.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.idempotencyKey.create).mockResolvedValue({} as never);
  vi.mocked(prisma.idempotencyKey.update).mockResolvedValue({} as never);
  vi.mocked(prisma.member.findFirst).mockResolvedValue({ id: 'm-1' } as never);
  vi.mocked(auditService.logAction).mockResolvedValue({} as never);
});

describe('SyncScansService — resolveAndAuthorize', () => {
  it("l'opérateur des scans est celui de la SESSION", async () => {
    vi.mocked(receiptService.createReceipt).mockResolvedValue(okReceipt);

    const result = await syncScansService.syncScans({
      items: [buildItem('cli-1')],
      organizationId: 'org-1',
      sessionUserId: 'u-session',
    });

    expect(result.results[0].status).toBe('ok');
    expect(receiptService.createReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ received_by: 'u-session' }),
      expect.anything()
    );
  });

  it('refuse une synchronisation sans session : personne ne signerait ces scans', async () => {
    // Le mode machine (« l'appelant déclare l'acteur ») a été retiré : sa seule pièce d'identité
    // était une clé API compilée dans le bundle mobile — donc publique. Vérifier que l'acteur
    // déclaré est membre empêchait de désigner un étranger, pas d'usurper un collègue.
    await expect(
      syncScansService.syncScans({
        items: [buildItem('cli-1')],
        organizationId: 'org-1',
        sessionUserId: undefined,
      })
    ).rejects.toMatchObject({ status: 401 });

    expect(receiptService.createReceipt).not.toHaveBeenCalled();
  });
});

describe('SyncScansService — processItem (atomique)', () => {
  it('happy path : crée receipt, persiste idempotency key, log audit DANS la même transaction', async () => {
    vi.mocked(receiptService.createReceipt).mockResolvedValue(okReceipt);

    const result = await syncScansService.syncScans({
      items: [buildItem('cli-1')],
      organizationId: 'org-1',
      sessionUserId: 'u-1',
    });

    expect(result.results[0]).toMatchObject({
      clientOpId: 'cli-1',
      status: 'ok',
      serverId: { receiptId: 'rcpt-1', batchId: 'bat-1' },
    });
    expect(result.summary).toEqual({ total: 1, ok: 1, error: 0, conflict: 0 });

    // Assertion forte : $transaction appelé avec Serializable + timeout 30s (atomicité WORM)
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        timeout: 30000,
        isolationLevel: 'Serializable',
      })
    );

    // receiptService reçoit le MÊME tx que celui propagé par $transaction (preuve d'atomicité)
    expect(receiptService.createReceipt).toHaveBeenCalledWith(expect.anything(), txClient);

    // auditService reçoit aussi le tx (audit dans la même transaction)
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        userId: 'u-1',
        action: 'CREATE_RECEIPT_VIA_SYNC',
        entity: 'Receipt',
        entityId: 'rcpt-1',
      }),
      txClient
    );

    // expires_at ≈ now + 7j (régression silencieuse sinon)
    const createCall = vi.mocked(prisma.idempotencyKey.create).mock.calls[0][0]!.data;
    const expiresAt = (createCall.expires_at as Date).getTime();
    const createdAt = (createCall.created_at as Date).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(expiresAt - createdAt).toBe(sevenDays);
  });

  it("default branch du switch runOperation : type non géré → status='error' avec field='type'", async () => {
    const malformedItem = {
      clientOpId: 'cli-9',
      type: 'transformation' as unknown as 'receipt', // bypass TS pour exercer le default
      payload: validReceiptPayload,
    };
    const result = await syncScansService.syncScans({
      items: [malformedItem],
      organizationId: 'org-1',
      sessionUserId: 'u-1',
    });
    expect(result.results[0].status).toBe('error');
    expect(result.results[0].error?.field).toBe('type');
    expect(receiptService.createReceipt).not.toHaveBeenCalled();
  });

  it('duplicate clientOpId dans le même batch : le 2ème est traité comme replay', async () => {
    // 1er passage : pas de clé → create + receipt OK
    // 2e passage : findUnique renvoie la clé créée au 1er (simulé via mockResolvedValueOnce)
    const item = buildItem('cli-dup');
    const { idempotencyService } = await import('../../../shared/utils/idempotency/idempotency.service');
    const realHash = idempotencyService.hashPayload(item.payload);

    vi.mocked(receiptService.createReceipt).mockResolvedValue(okReceipt);
    vi.mocked(prisma.idempotencyKey.findUnique)
      .mockResolvedValueOnce(null) // 1er item : pas de clé
      .mockResolvedValueOnce({
        request_hash: realHash,
        response_payload: {
          clientOpId: 'cli-dup',
          status: 'ok',
          serverId: { receiptId: 'rcpt-1', batchId: 'bat-1' },
        },
      } as never); // 2e item : replay

    const result = await syncScansService.syncScans({
      items: [item, item], // duplicate intentionnel
      organizationId: 'org-1',
      sessionUserId: 'u-1',
    });

    expect(result.results).toHaveLength(2);
    expect(result.results[0].status).toBe('ok');
    expect(result.results[1].status).toBe('ok');
    // Receipt créé une seule fois — le 2e item est un replay
    expect(receiptService.createReceipt).toHaveBeenCalledTimes(1);
  });

  it('idempotency replay : même clientOpId + même hash → renvoie la réponse cachée, pas de recréation', async () => {
    const cached = {
      clientOpId: 'cli-1',
      status: 'ok',
      serverId: { receiptId: 'rcpt-cache', batchId: 'bat-cache' },
    };
    // Hash calculé en avance pour matcher
    const item = buildItem('cli-1');
    const { idempotencyService } = await import('../../../shared/utils/idempotency/idempotency.service');
    const realHash = idempotencyService.hashPayload(item.payload);

    vi.mocked(prisma.idempotencyKey.findUnique).mockResolvedValue({
      request_hash: realHash,
      response_payload: cached,
    } as never);

    const result = await syncScansService.syncScans({
      items: [item],
      organizationId: 'org-1',
      sessionUserId: 'u-1',
    });

    expect(result.results[0]).toMatchObject(cached);
    expect(receiptService.createReceipt).not.toHaveBeenCalled();
    expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("idempotency conflict : même clientOpId + hash divergent → status='conflict' via vrai APIError(409)", async () => {
    vi.mocked(prisma.idempotencyKey.findUnique).mockResolvedValue({
      request_hash: 'hash-divergent',
      response_payload: {},
    } as never);

    const result = await syncScansService.syncScans({
      items: [buildItem('cli-1')],
      organizationId: 'org-1',
      sessionUserId: 'u-1',
    });

    expect(result.results[0].status).toBe('conflict');
    expect(result.results[0].error?.field).toBe('clientOpId');
    expect(receiptService.createReceipt).not.toHaveBeenCalled();
  });

  it("partial success : items indépendants, l'échec d'un n'annule pas l'autre", async () => {
    vi.mocked(receiptService.createReceipt)
      .mockResolvedValueOnce(okReceipt)
      .mockRejectedValueOnce(
        new APIError(404, {
          error: [{ field: 'id_fournisseur', message: 'Fournisseur introuvable ou accès refusé' }],
        })
      )
      .mockResolvedValueOnce({ message: 'ok', receiptId: 'rcpt-3', batchId: 'bat-3' });

    const result = await syncScansService.syncScans({
      items: [buildItem('cli-1'), buildItem('cli-2'), buildItem('cli-3')],
      organizationId: 'org-1',
      sessionUserId: 'u-1',
    });

    expect(result.summary).toEqual({ total: 3, ok: 2, error: 1, conflict: 0 });
    expect(result.results[0].status).toBe('ok');
    expect(result.results[1].status).toBe('error');
    expect(result.results[1].error?.field).toBe('id_fournisseur');
    expect(result.results[2].status).toBe('ok');
  });

  // Le mock $transaction ne simule pas le vrai rollback Prisma — il propage juste les throws.
  // L'atomicité réelle (rollback de Receipt + IdempotencyKey + Audit_Log si audit échoue)
  // est validée end-to-end par `scripts/e2e-mobile-sync.ts` scénarios 1-5 + via la DB.
  it.todo('integration: real Prisma rollback when audit throws (cf. e2e-mobile-sync.ts)');

  it('audit failure : la transaction rollback → item en error + message générique (no info leak)', async () => {
    vi.mocked(receiptService.createReceipt).mockResolvedValue(okReceipt);
    // Erreur brute façon Prisma : on s'assure qu'elle NE remonte PAS au client
    vi.mocked(auditService.logAction).mockRejectedValue(
      new Error('PostgreSQL connection lost at 10.0.0.42:5432 — pg_hba.conf denied')
    );

    const result = await syncScansService.syncScans({
      items: [buildItem('cli-1')],
      organizationId: 'org-1',
      sessionUserId: 'u-1',
    });

    // L'audit a bien été tenté (preuve qu'on a atteint cette étape avant le rollback)
    expect(auditService.logAction).toHaveBeenCalled();
    // L'item passe en error
    expect(result.results[0].status).toBe('error');
    // Message GÉNÉRIQUE — le détail Prisma ne fuit pas vers le mobile
    expect(result.results[0].error?.field).toBe('internal');
    expect(result.results[0].error?.message).toBe('Erreur interne du serveur');
    expect(result.results[0].error?.message).not.toContain('PostgreSQL');
    expect(result.results[0].error?.message).not.toContain('pg_hba');
  });

  it('received_by toujours forcé : un actorUserId malveillant en session ne passe jamais', async () => {
    vi.mocked(receiptService.createReceipt).mockResolvedValue(okReceipt);

    await syncScansService.syncScans({
      items: [buildItem('cli-1')],
      organizationId: 'org-1',
      sessionUserId: 'u-legit',
      actorUserId: 'OTHER-USER-666',
    });

    // Sweep complet : la valeur malveillante ne doit apparaître NULLE PART downstream
    const allCallsSnapshot = JSON.stringify({
      receipt: vi.mocked(receiptService.createReceipt).mock.calls,
      audit: vi.mocked(auditService.logAction).mock.calls,
      idemCreate: vi.mocked(prisma.idempotencyKey.create).mock.calls,
      idemUpdate: vi.mocked(prisma.idempotencyKey.update).mock.calls,
    });
    expect(allCallsSnapshot).not.toContain('OTHER-USER-666');
  });
});
