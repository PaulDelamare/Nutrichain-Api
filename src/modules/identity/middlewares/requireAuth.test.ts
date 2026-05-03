import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { requireAuth } from './requireAuth.middleware';

describe('Auth Middleware - requireAuth', () => {

    afterEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('doit bloquer -401- les requêtes sans session (pas de cookie/token)', async () => {
        // Obtenir le vrai middleware en mockant better-auth
        vi.doMock('../auth.config', () => ({
            auth: {
                api: {
                    getSession: vi.fn().mockResolvedValue(null) // Renvoie `null` = pas connecté
                }
            }
        }));

        const { requireAuth } = await import('./requireAuth.middleware');

        const app = express();
        app.get('/protected', requireAuth, (req, res) => res.status(200).json({ secret: 'data' }));

        const res = await request(app).get('/protected');

        expect(res.status).toBe(401);
        expect(res.body.message).toMatch(/Accès refusé/);
    });

    it('doit autoriser l\'accès et injecter req.user si la session est valide', async () => {
        const mockUser = { id: 1, email: "john@usine.com" };
        const mockSession = { id: 'sess_123', token: 'abcd' };

        // Obtenir le vrai middleware en mockant better-auth pour qu'il le valide
        vi.doMock('../auth.config', () => ({
            auth: {
                api: {
                    getSession: vi.fn().mockResolvedValue({
                        session: mockSession,
                        user: mockUser
                    })
                }
            }
        }));

        const { requireAuth } = await import('./requireAuth.middleware');

        const app = express();
        app.get('/protected', requireAuth, (req: any, res) => {
            // Le middleware a injecté la session : on la renvoie pour tester
            res.status(200).json({
                secret: 'data',
                userEmail: req.user.email
            });
        });

        // Appeler la route test : 
        // Le mock getSession fait foi, peu importe le header qu'on passe
        const res = await request(app)
            .get('/protected')
            .set('Authorization', 'Bearer MOCK_TOKEN');

        expect(res.status).toBe(200);
        expect(res.body.secret).toBe('data');
        expect(res.body.userEmail).toBe('john@usine.com'); // La donnée provenant du middleware
    });
});