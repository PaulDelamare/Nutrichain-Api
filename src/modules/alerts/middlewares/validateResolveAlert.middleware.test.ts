import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response, NextFunction } from 'express';
import { validateResolveAlert } from './validateResolveAlert.middleware';
import type { AuthenticatedRequest } from '../../identity/types/auth.types';

const res = {} as Response;

const buildReq = (body: unknown): AuthenticatedRequest =>
  ({ body }) as unknown as AuthenticatedRequest;

describe('validateResolveAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. body vide {} → next() avec validatedResolveAlert.note === undefined', async () => {
    const req = buildReq({});
    const next = vi.fn() as NextFunction;

    await validateResolveAlert(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.validatedResolveAlert).toEqual({ note: undefined });
  });

  it('2. body avec note string valide → next() avec note attachée', async () => {
    const req = buildReq({ note: 'Nettoyage capteur effectué.' });
    const next = vi.fn() as NextFunction;

    await validateResolveAlert(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.validatedResolveAlert?.note).toBe('Nettoyage capteur effectué.');
  });

  it('3. boundary : note de 500 chars → accepté', async () => {
    const note = 'a'.repeat(500);
    const req = buildReq({ note });
    const next = vi.fn() as NextFunction;

    await validateResolveAlert(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.validatedResolveAlert?.note).toBe(note);
  });

  it("4. boundary : note de 501 chars → 400 avec field 'note' (via next())", async () => {
    const note = 'a'.repeat(501);
    const req = buildReq({ note });
    const next = vi.fn() as NextFunction;

    await validateResolveAlert(req, res, next);

    // `validateData` throw un objet plain `{ status, error }` que `catchAsync` propage à next.
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      status: number;
      error: { field: string }[];
    };
    expect(err.status).toBe(400);
    expect(err.error[0].field).toBe('note');
  });

  it("5. empty string '' → traité comme absent (validatedResolveAlert.note === undefined)", async () => {
    const req = buildReq({ note: '' });
    const next = vi.fn() as NextFunction;

    await validateResolveAlert(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.validatedResolveAlert?.note).toBeUndefined();
  });
});
