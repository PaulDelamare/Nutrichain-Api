import { describe, it, expect, vi } from 'vitest';
import { idempotencyService } from './idempotency.service';

const buildTx = (existing: unknown) =>
  ({
    idempotencyKey: {
      findUnique: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

const baseParams = {
  organizationId: 'org-1',
  clientOpId: 'op-1',
  userId: 'user-1',
  requestHash: 'hash-A',
  ttlMs: 1000,
};

describe('IdempotencyService.hashPayload', () => {
  it('produit un SHA256 hex (64 chars hex) stable pour un payload identique', () => {
    const payload = { foo: 'bar', n: 42 };
    const h1 = idempotencyService.hashPayload(payload);
    const h2 = idempotencyService.hashPayload(payload);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("normalise l'ordre des clés (même hash indépendamment de l'ordre)", () => {
    const h1 = idempotencyService.hashPayload({ a: 1, b: 2 });
    const h2 = idempotencyService.hashPayload({ b: 2, a: 1 });
    expect(h1).toBe(h2);
  });

  it('normalise récursivement les objets imbriqués', () => {
    const h1 = idempotencyService.hashPayload({ x: { a: 1, b: 2 }, y: 'z' });
    const h2 = idempotencyService.hashPayload({ y: 'z', x: { b: 2, a: 1 } });
    expect(h1).toBe(h2);
  });

  it('hashs différents pour payloads différents', () => {
    const h1 = idempotencyService.hashPayload({ a: 1 });
    const h2 = idempotencyService.hashPayload({ a: 2 });
    expect(h1).not.toBe(h2);
  });

  it('traite les arrays en préservant leur ordre', () => {
    const h1 = idempotencyService.hashPayload({ arr: [1, 2, 3] });
    const h2 = idempotencyService.hashPayload({ arr: [3, 2, 1] });
    expect(h1).not.toBe(h2);
  });
});

describe('IdempotencyService.claim / finalize', () => {
  it('clé absente → first-write : place un placeholder pending, replay=false', async () => {
    const tx = buildTx(null);
    const res = await idempotencyService.claim(tx, baseParams);

    expect(res.replay).toBe(false);
    expect(tx.idempotencyKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organization_id: 'org-1',
          client_op_id: 'op-1',
          user_id: 'user-1',
          request_hash: 'hash-A',
          response_status: 'pending',
        }),
      })
    );
  });

  it('clé présente + même hash → replay avec le payload caché, aucune écriture', async () => {
    const tx = buildTx({ request_hash: 'hash-A', response_payload: { serverId: 'srv-1' } });
    const res = await idempotencyService.claim(tx, baseParams);

    expect(res).toEqual({ replay: true, payload: { serverId: 'srv-1' } });
    expect(tx.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('clé présente + hash DIFFÉRENT → 409 (le client a rejoué avec un autre contenu)', async () => {
    const tx = buildTx({ request_hash: 'hash-DIFFERENT', response_payload: {} });

    await expect(idempotencyService.claim(tx, baseParams)).rejects.toMatchObject({ status: 409 });
    expect(tx.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('finalize passe la clé en ok avec le payload de réponse', async () => {
    const tx = buildTx(null);
    await idempotencyService.finalize(tx, {
      organizationId: 'org-1',
      clientOpId: 'op-1',
      payload: { serverId: 'srv-1' },
    });

    expect(tx.idempotencyKey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { response_status: 'ok', response_payload: { serverId: 'srv-1' } },
      })
    );
  });
});
