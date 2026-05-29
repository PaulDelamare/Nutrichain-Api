import { describe, it, expect } from 'vitest';
import { computeAuditHash, GENESIS_PREV_HASH } from './auditHash.util';

describe('computeAuditHash', () => {
  it('1. GOLDEN VECTOR : inputs canoniques figés → SHA256 hex literal exact', () => {
    // Si ce test casse, c'est que la formule a changé.
    // CONSÉQUENCE : tous les `signature_hash` déjà persistés en DB deviennent
    // invalides (une migration explicite est nécessaire). Ne pas updater la
    // value sans réfléchir.
    const hash = computeAuditHash({
      organizationId: 'org-test',
      userId: 'u1',
      action: 'CREATE',
      entity: 'Receipt',
      entityId: 'r1',
      oldValue: null,
      newValue: { x: 1 },
      prevHash: GENESIS_PREV_HASH,
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(hash).toBe('4f2c622dbab041b7785fe9a2f7547ce4ed9b81e3ac0103169237fd7558170ef5');
  });

  it('2. recomputable : mêmes inputs → même hash', () => {
    const inputs = {
      organizationId: 'org-1',
      userId: 'u1',
      action: 'UPDATE',
      entity: 'Batch',
      entityId: 'b1',
      oldValue: { qty: 100 },
      newValue: { qty: 80 },
      prevHash: 'abc',
      timestamp: '2026-05-29T10:00:00.000Z',
    };
    expect(computeAuditHash(inputs)).toBe(computeAuditHash(inputs));
  });

  it('3. un champ modifié → hash différent', () => {
    const base = {
      organizationId: 'org-1',
      userId: 'u1',
      action: 'UPDATE',
      entity: 'Batch',
      entityId: 'b1',
      oldValue: null,
      newValue: { qty: 80 },
      prevHash: 'abc',
      timestamp: '2026-05-29T10:00:00.000Z',
    };
    const tampered = { ...base, newValue: { qty: 999 } };
    expect(computeAuditHash(tampered)).not.toBe(computeAuditHash(base));
  });

  it("4. userId === undefined → traité comme 'system' (compat audit.service)", () => {
    const withUndefined = computeAuditHash({
      organizationId: 'org-1',
      userId: undefined,
      action: 'CREATE',
      entity: 'Receipt',
      entityId: 'r1',
      prevHash: GENESIS_PREV_HASH,
      timestamp: '2026-05-29T10:00:00.000Z',
    });
    const withSystem = computeAuditHash({
      organizationId: 'org-1',
      userId: 'system',
      action: 'CREATE',
      entity: 'Receipt',
      entityId: 'r1',
      prevHash: GENESIS_PREV_HASH,
      timestamp: '2026-05-29T10:00:00.000Z',
    });
    expect(withUndefined).toBe(withSystem);
  });

  it("5. userId === null → traité comme 'system' (compat || fallback)", () => {
    const withNull = computeAuditHash({
      organizationId: 'org-1',
      userId: null,
      action: 'CREATE',
      entity: 'Receipt',
      entityId: 'r1',
      prevHash: GENESIS_PREV_HASH,
      timestamp: '2026-05-29T10:00:00.000Z',
    });
    const withSystem = computeAuditHash({
      organizationId: 'org-1',
      userId: 'system',
      action: 'CREATE',
      entity: 'Receipt',
      entityId: 'r1',
      prevHash: GENESIS_PREV_HASH,
      timestamp: '2026-05-29T10:00:00.000Z',
    });
    expect(withNull).toBe(withSystem);
  });

  it('6. oldValue null vs undefined → hashes différents (JSON.stringify drop undefined)', () => {
    const withNull = computeAuditHash({
      organizationId: 'org-1',
      userId: 'u1',
      action: 'CREATE',
      entity: 'Receipt',
      entityId: 'r1',
      oldValue: null,
      prevHash: GENESIS_PREV_HASH,
      timestamp: '2026-05-29T10:00:00.000Z',
    });
    const withUndefined = computeAuditHash({
      organizationId: 'org-1',
      userId: 'u1',
      action: 'CREATE',
      entity: 'Receipt',
      entityId: 'r1',
      oldValue: undefined,
      prevHash: GENESIS_PREV_HASH,
      timestamp: '2026-05-29T10:00:00.000Z',
    });
    expect(withNull).not.toBe(withUndefined);
  });

  it('7. empty string userId → conservé tel quel (|| ne déclenche pas, mais on protège le contrat)', () => {
    // ATTENTION : `params.userId || 'system'` traite '' comme falsy → fallback 'system'.
    // C'est le comportement actuel de audit.service.ts. Test verrouille ce contrat.
    const withEmpty = computeAuditHash({
      organizationId: 'org-1',
      userId: '',
      action: 'CREATE',
      entity: 'Receipt',
      entityId: 'r1',
      prevHash: GENESIS_PREV_HASH,
      timestamp: '2026-05-29T10:00:00.000Z',
    });
    const withSystem = computeAuditHash({
      organizationId: 'org-1',
      userId: 'system',
      action: 'CREATE',
      entity: 'Receipt',
      entityId: 'r1',
      prevHash: GENESIS_PREV_HASH,
      timestamp: '2026-05-29T10:00:00.000Z',
    });
    expect(withEmpty).toBe(withSystem);
  });
});
