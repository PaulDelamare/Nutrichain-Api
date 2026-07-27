import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { globalErrorHandler } from './errorHandler';
import { requestIdMiddleware } from '../../middlewares/requestId.middleware';
import { logger } from '../logger/logger';

/**
 * Ces cas passent par une vraie application Express — `requestIdMiddleware` puis
 * `globalErrorHandler` — et non par un appel direct à `handleError` avec un `{} as Request`.
 * Le défaut d'origine (#252) n'était pas dans la fonction : il était dans ce qui sort sur le
 * réseau, et un test qui fabrique lui-même sa requête ne peut pas le voir.
 */
const buildApp = (thrown: unknown) => {
  const app = express();
  app.use(requestIdMiddleware);
  app.get('/boom', (_req: Request, _res: Response, next: NextFunction) => next(thrown));
  app.use(globalErrorHandler);
  return app;
};

const bodyText = (body: unknown) => JSON.stringify(body);

describe('globalErrorHandler câblé — aucun détail technique ne sort en 500', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('masque le message d’une erreur générique et renvoie une référence', async () => {
    const res = await request(buildApp(new Error('Generic error'))).get('/boom');

    expect(res.status).toBe(500);
    expect(bodyText(res.body)).not.toContain('Generic error');
    expect(res.body.error[0].message).toContain('Référence');
    expect(res.body.error[0].message).toContain(res.headers['x-request-id']);
  });

  it('masque la topologie d’un PrismaClientInitializationError', async () => {
    const error = new Prisma.PrismaClientInitializationError(
      "Can't reach database server at postgres-interne:5432",
      '6.0.0'
    );

    const res = await request(buildApp(error)).get('/boom');

    expect(res.status).toBe(500);
    expect(bodyText(res.body)).not.toContain('postgres-interne');
    expect(bodyText(res.body)).not.toContain('5432');
  });

  it('masque le dump de modèle d’un PrismaClientValidationError', async () => {
    const error = new Prisma.PrismaClientValidationError(
      'Invalid `prisma.batch.findMany()` invocation: Unknown field `lot_number` for select statement on model Batch',
      { clientVersion: '6.0.0' }
    );

    const res = await request(buildApp(error)).get('/boom');

    expect(res.status).toBe(500);
    expect(bodyText(res.body)).not.toContain('lot_number');
    expect(bodyText(res.body)).not.toContain('Batch');
  });

  /**
   * La `APIError` de Better-Auth porte un `status` TEXTUEL (« INTERNAL_SERVER_ERROR ») et non un
   * nombre. Une garde écrite `status >= 500` le compare à NaN, donc la laisse passer ; et
   * `res.status('INTERNAL_SERVER_ERROR')` fait lever Node.
   */
  it('masque une erreur dont le status est textuel, sans planter sur res.status()', async () => {
    const error = Object.assign(new Error('better-auth internal detail'), {
      name: 'APIError',
      status: 'INTERNAL_SERVER_ERROR',
    });

    const res = await request(buildApp(error)).get('/boom');

    expect(res.status).toBe(500);
    expect(bodyText(res.body)).not.toContain('better-auth internal detail');
    // Sans cette ligne le test passerait sur un plantage : Node lève sur un status non numérique,
    // Express répond sa propre page 500, qui ne contient pas non plus le message.
    expect(res.body.error[0].message).toContain('Référence');
  });

  /**
   * Better-Auth porte le code numérique dans `statusCode`, à côté d'un `status` textuel. Le lire
   * n'est pas un détail : sans lui, un refus d'autorisation devient un 500. Le client ne sait plus
   * qu'il doit se reconnecter — il croit à une panne et réessaie.
   */
  it('préserve un refus d’autorisation Better-Auth au lieu de le noyer en 500', async () => {
    const error = Object.assign(new Error('ignored'), {
      name: 'APIError',
      status: 'FORBIDDEN',
      statusCode: 403,
      body: { error: [{ field: 'role', message: 'Accès refusé pour ce rôle.' }] },
    });

    const res = await request(buildApp(error)).get('/boom');

    expect(res.status).toBe(403);
    expect(res.body.error[0].message).toBe('Accès refusé pour ce rôle.');
  });

  it('journalise le détail technique que le client ne reçoit pas', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => logger);

    await request(buildApp(new Error('Generic error'))).get('/boom');

    const logged = spy.mock.calls.map((call) => JSON.stringify(call)).join(' ');
    expect(logged).toContain('Generic error');
  });

  /**
   * La « Référence » n'a de valeur que si elle mène quelque part. Sans cette assertion, retirer le
   * `{ requestId }` des appels au journal ne ferait rougir aucun test, et l'identifiant communiqué
   * à l'utilisateur resterait introuvable côté serveur.
   */
  it('journalise sous le même requestId que celui renvoyé au client', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => logger);

    const res = await request(buildApp(new Error('Generic error'))).get('/boom');

    const returned = res.headers['x-request-id'];
    expect(res.body.error[0].message).toContain(returned);
    expect(spy.mock.calls.some((call) => call[1]?.requestId === returned)).toBe(true);
  });

  /**
   * Contre-épreuve : sans elle, on ne saurait pas distinguer « les 500 sont masquées » de
   * « toutes les erreurs sont masquées », ce qui rendrait les 400 métier inutilisables.
   */
  it('laisse intact le message métier d’une erreur 4xx', async () => {
    const error = Object.assign(new Error('ignored'), {
      status: 400,
      error: [{ field: 'lot_number', message: 'Le numéro de lot est obligatoire.' }],
    });

    const res = await request(buildApp(error)).get('/boom');

    expect(res.status).toBe(400);
    expect(res.body.error[0].message).toBe('Le numéro de lot est obligatoire.');
  });
});
