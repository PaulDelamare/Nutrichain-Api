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
            error: "Erreur : le champ inconnu doit être unique. La valeur fournie est déjà utilisée.",
        });
    });

    it('should handle unknown Prisma error', () => {

        const error = {
            code: 'P9999',
        } as Prisma.PrismaClientKnownRequestError;

        handleError(error, mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockRes.json).toHaveBeenCalledWith({
            status: 500,
            error: "Erreur serveur inconnue",
        });
    });

    it('should handle generic error', () => {

        const error = new Error('Generic error');

        handleError(error, mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockRes.json).toHaveBeenCalledWith({
            status: 500,
            error: 'Generic error',
        });
    });
});
