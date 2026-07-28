import { describe, it, expect, vi } from 'vitest';
import { handleError } from './errorHandler';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

// ! Tests
describe('handleError middleware', () => {
  const mockReq = {} as Request;
  const mockRes = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;

  it('should handle Prisma errors', () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError('Prisma error', {
      code: 'P2002',
      clientVersion: '4.0.0',
    });

    const resSpy = vi.spyOn(mockRes, 'json');
    handleError(prismaError, mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(resSpy).toHaveBeenCalledWith({
      status: 400,
      error: [
        {
          field: 'database',
          message:
            'Erreur : le champ inconnu doit être unique. La valeur fournie est déjà utilisée.',
        },
      ],
    });
  });

  /**
   * Cet objet n'est pas une instance Prisma — il tombe dans la branche « valeur jetée non typée ».
   * Le nom d'origine (« unknown Prisma error ») décrivait un chemin que le test n'empruntait pas.
   */
  it('renvoie un message générique pour une valeur jetée non typée', () => {
    const error = {
      code: 'P9999',
    } as unknown as Prisma.PrismaClientKnownRequestError;

    handleError(error, mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      status: 500,
      error: [
        {
          field: 'server',
          message: 'Une erreur interne est survenue. Référence : non disponible',
        },
      ],
    });
  });

  /**
   * Le test qui vivait ici assertait `message: 'Generic error'` : il entérinait la divulgation
   * que corrige #252. Il vérifie désormais l'inverse — et que la réponse reste exploitable pour
   * signaler l'incident.
   */
  it('ne divulgue pas le message d’une erreur générique', () => {
    const error = new Error('Generic error');

    handleError(error, mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(vi.mocked(mockRes.json).mock.calls)).not.toContain('Generic error');
  });

  /**
   * `req.requestId` est optionnel : sans le middleware, le message ne doit pas afficher
   * « Référence : undefined » à l'utilisateur.
   */
  it('reste lisible quand aucun requestId n’a été posé', () => {
    handleError(new Error('boom'), mockReq, mockRes);

    expect(mockRes.json).toHaveBeenCalledWith({
      status: 500,
      error: [
        {
          field: 'server',
          message: 'Une erreur interne est survenue. Référence : non disponible',
        },
      ],
    });
  });
});
