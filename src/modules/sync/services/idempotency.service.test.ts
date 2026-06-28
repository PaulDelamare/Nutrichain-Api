import { describe, it, expect } from 'vitest';
import { idempotencyService } from './idempotency.service';

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
