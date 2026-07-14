import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { validateBatchResolve } from './validateBatchResolve.middleware';
import { globalErrorHandler } from '../../../../shared/utils/errorHandler/errorHandler';
import { AuthenticatedRequest } from '../../../identity/types/auth.types';

// Le numéro de lot vient d'un code SCANNÉ : c'est une entrée non fiable, et c'est la seule chose que
// cette route accepte. Sans ces tests, retirer la validation de la route ne fait rougir aucun test.
const app = express();
app.get(
  '/resolve',
  validateBatchResolve,
  (req: AuthenticatedRequest, res: express.Response) => {
    res.status(200).json({ lot_number: req.validatedBatchResolve?.lot_number });
  }
);
app.use(globalErrorHandler);

const resolve = (query: string) => request(app).get(`/resolve${query}`);

describe('validateBatchResolve', () => {
  it('accepte un numéro de lot et le transmet au contrôleur', async () => {
    const res = await resolve('?lot_number=FRN-ABC123');

    expect(res.status).toBe(200);
    expect(res.body.lot_number).toBe('FRN-ABC123');
  });

  it('rogne les espaces autour du code (un scanner en ajoute)', async () => {
    const res = await resolve('?lot_number=%20FRN-ABC123%20');

    expect(res.status).toBe(200);
    expect(res.body.lot_number).toBe('FRN-ABC123');
  });

  it.each([
    ['absent', ''],
    ['vide', '?lot_number='],
    ['réduit à des espaces', '?lot_number=%20%20'],
    // 21 caractères : au-delà de la limite GS1 de l'AI 10, ce n'est plus un numéro de lot.
    ['trop long', `?lot_number=${'A'.repeat(21)}`],
    // Un client qui répète le paramètre produit un TABLEAU, pas une chaîne.
    ['répété (tableau)', '?lot_number=a&lot_number=b'],
    // Et la notation crochets produit un OBJET : sans garde, il partirait tel quel vers Prisma.
    ['un objet', '?lot_number[x]=1'],
  ])('refuse un numéro %s — en 400, jamais en 500', async (_cas, query) => {
    const res = await resolve(query);

    expect(res.status).toBe(400);
  });
});
