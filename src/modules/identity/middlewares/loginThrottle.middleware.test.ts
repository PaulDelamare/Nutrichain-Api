import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../types/auth.types';

const upsert = vi.fn();
const update = vi.fn();
const deleteMany = vi.fn();

vi.mock('../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    loginAttempt: {
      upsert: (...a: unknown[]) => upsert(...a),
      update: (...a: unknown[]) => update(...a),
      deleteMany: (...a: unknown[]) => deleteMany(...a),
    },
  },
}));

const { loginThrottle, MAX_FAILED_ATTEMPTS, WINDOW_MINUTES } = await import(
  './loginThrottle.middleware'
);

const attempt = (patch: Record<string, unknown> = {}) => ({
  email_hash: 'peu-importe',
  failed_count: 1,
  first_failed_at: new Date(),
  locked_until: null,
  ...patch,
});

const buildRes = (statusCode: number) => {
  const res = new EventEmitter() as unknown as Response & EventEmitter;
  (res as unknown as { statusCode: number }).statusCode = statusCode;
  return res;
};

const run = async (email: unknown, statusCode = 401) => {
  const req = { body: { email } } as unknown as AuthenticatedRequest;
  const res = buildRes(statusCode);
  const next = vi.fn();

  await loginThrottle(req, res as unknown as Response, next);
  res.emit('finish');
  await new Promise((r) => setImmediate(r));

  return { next, error: next.mock.calls[0]?.[0] as { status?: number } | undefined };
};

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockResolvedValue(attempt());
  update.mockResolvedValue({});
  deleteMany.mockResolvedValue({ count: 0 });
});

describe('loginThrottle', () => {
  /**
   * ⚠️ L'invariant central. Compter la tentative APRÈS la réponse a été mesuré défaillant : huit
   * tentatives simultanées lisaient le même compteur avant de le réécrire (neuf échecs n'en
   * valaient que deux), et un client qui coupait la connexion n'était jamais compté. L'incrément
   * doit donc être atomique et posé AVANT que la tentative n'atteigne l'authentification.
   */
  it("incrémente atomiquement AVANT de laisser passer, sans lire le compteur d'abord", async () => {
    const { next } = await run('operator@nutrichain.local');

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { failed_count: { increment: 1 } } })
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('verrouille quand le seuil est atteint', async () => {
    upsert.mockResolvedValue(attempt({ failed_count: MAX_FAILED_ATTEMPTS }));

    const { error } = await run('operator@nutrichain.local');

    expect(error?.status).toBe(429);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { locked_until: expect.any(Date) } })
    );
  });

  it('refuse en 429 pendant le verrou, mot de passe correct compris', async () => {
    upsert.mockResolvedValue(
      attempt({ failed_count: 9, locked_until: new Date(Date.now() + 10 * 60 * 1000) })
    );

    const { error } = await run('operator@nutrichain.local', 200);

    expect(error?.status).toBe(429);
    // La tentative n'atteint jamais l'authentification : rien ne doit être vérifié ni effacé.
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('efface le compteur après une connexion réussie', async () => {
    await run('operator@nutrichain.local', 200);

    expect(deleteMany).toHaveBeenCalled();
  });

  it("n'efface rien après un échec", async () => {
    await run('operator@nutrichain.local', 401);

    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('repart d’une ardoise vierge quand la fenêtre est expirée', async () => {
    upsert.mockResolvedValue(
      attempt({
        failed_count: MAX_FAILED_ATTEMPTS + 3,
        first_failed_at: new Date(Date.now() - (WINDOW_MINUTES + 1) * 60 * 1000),
      })
    );

    const { next } = await run('operator@nutrichain.local');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { failed_count: 1, first_failed_at: expect.any(Date), locked_until: null },
      })
    );
    expect(next).toHaveBeenCalledWith();
  });

  it("ne touche pas à la base et laisse répondre l'authentification si l'e-mail est absent ou mal typé", async () => {
    for (const value of [undefined, '', '   ', 42, { a: 1 }]) {
      vi.clearAllMocks();
      const { next } = await run(value);

      expect(next).toHaveBeenCalledWith();
      expect(upsert).not.toHaveBeenCalled();
    }
  });

  it("indexe sur une empreinte, jamais sur l'e-mail en clair, et normalise la casse", async () => {
    await run('  Operator@Nutrichain.Local  ');
    const key1 = (upsert.mock.calls[0]?.[0] as { where: { email_hash: string } }).where.email_hash;

    vi.clearAllMocks();
    upsert.mockResolvedValue(attempt());
    await run('operator@nutrichain.local');
    const key2 = (upsert.mock.calls[0]?.[0] as { where: { email_hash: string } }).where.email_hash;

    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[a-f0-9]{64}$/);
    expect(key1).not.toContain('operator');
  });
});
