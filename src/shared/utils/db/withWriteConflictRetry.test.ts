import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { withWriteConflictRetry } from './withWriteConflictRetry';

const knownError = (code: string, target?: string[]) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test',
    meta: target ? { target } : undefined,
  });

describe('withWriteConflictRetry', () => {
  it('rejoue puis réussit sur un conflit de sérialisation (P2034)', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(knownError('P2034'))
      .mockRejectedValueOnce(knownError('P2034'))
      .mockResolvedValueOnce('ok');

    await expect(withWriteConflictRetry(op)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("rejoue un conflit de sérialisation remonté par une requête brute (P2010 / SQLSTATE 40001)", async () => {
    // La relecture du dernier maillon d'audit passe par `$queryRaw` : Prisma n'y remonte pas P2034
    // mais un P2010 porteur du SQLSTATE. Sans ce cas, un conflit NOMINAL sortait en 500.
    const rawConflict = new Prisma.PrismaClientKnownRequestError(
      'Raw query failed. Code: `40001`. Message: `could not serialize access`',
      { code: 'P2010', clientVersion: 'test', meta: { code: '40001' } }
    );
    const op = vi.fn().mockRejectedValueOnce(rawConflict).mockResolvedValueOnce('ok');

    await expect(withWriteConflictRetry(op)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('NE rejoue PAS une requête brute invalide (P2010 sans conflit de sérialisation)', async () => {
    const sqlError = new Prisma.PrismaClientKnownRequestError(
      'Raw query failed. Code: `42601`. Message: `syntax error`',
      { code: 'P2010', clientVersion: 'test', meta: { code: '42601' } }
    );
    const op = vi.fn().mockRejectedValue(sqlError);

    await expect(withWriteConflictRetry(op)).rejects.toBe(sqlError);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('rejoue sur un fork de la chaîne d’audit (P2002 sur prev_hash)', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(knownError('P2002', ['organization_id', 'prev_hash']))
      .mockResolvedValueOnce('ok');

    await expect(withWriteConflictRetry(op)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('NE rejoue PAS un P2002 métier (autre contrainte) — relayé tel quel pour un 409', async () => {
    // Un GTIN ou un shipment_id en double est une vraie erreur déterministe : rejouer ne
    // changerait rien et masquerait le 409. On la relaie immédiatement.
    const err = knownError('P2002', ['code_gtin']);
    const op = vi.fn().mockRejectedValue(err);

    await expect(withWriteConflictRetry(op)).rejects.toBe(err);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('NE rejoue PAS une erreur applicative (ex. APIError, non Prisma)', async () => {
    const err = new Error('validation');
    const op = vi.fn().mockRejectedValue(err);

    await expect(withWriteConflictRetry(op)).rejects.toBe(err);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('abandonne après 10 tentatives sur conflit persistant', async () => {
    const err = knownError('P2034');
    const op = vi.fn().mockRejectedValue(err);

    await expect(withWriteConflictRetry(op)).rejects.toBe(err);
    expect(op).toHaveBeenCalledTimes(10);
  });
});
