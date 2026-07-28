import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { globalErrorHandler } from '../../shared/utils/errorHandler/errorHandler';
import { AuthenticatedRequest, AuthUser, AuthSession } from '../identity/types/auth.types';

/**
 * Le jeton exact que porte la session. Les assertions cherchent CETTE valeur dans le corps sérialisé
 * — pas la présence d'une clé `session` — parce que c'est la fuite qui compte : un futur champ
 * imbriqué, un `...req.auth` ou un « on renvoie tout l'objet » la ramènerait sous un autre nom.
 */
const JETON = 'jeton-de-session-qui-ne-doit-jamais-sortir';

vi.mock('../identity/middlewares/requireAuth.middleware', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as AuthenticatedRequest).auth = {
      user: {
        id: 'user-1',
        name: 'Olivia Opératrice',
        email: 'operator@nutrichain.local',
        emailVerified: true,
        image: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
        // Présent à l'exécution alors qu'`AuthUser` ne le déclare pas — et le front le lit
        // (`hooks.server.ts`). Une projection qui l'oublierait afficherait « 2FA désactivée » à
        // quelqu'un qui l'a activée.
        twoFactorEnabled: true,
      } as unknown as AuthUser,
      session: {
        id: 'session-1',
        userId: 'user-1',
        token: JETON,
        ipAddress: '203.0.113.7',
        userAgent: 'Mozilla/5.0 (poste de l opérateur)',
        expiresAt: new Date('2026-12-31'),
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
        activeOrganizationId: 'org-1',
      } as unknown as AuthSession,
      activeOrgId: 'org-1',
    };
    (req as AuthenticatedRequest).activeOrgId = 'org-1';
    next();
  },
}));

vi.mock('../identity/utils/resolveActiveOrgRole', () => ({
  resolveActiveOrgRole: vi.fn(),
}));

vi.mock('../../shared/configs/prismaClient.config', () => ({
  prisma: { platformAdmin: { findUnique: vi.fn() } },
}));

import helloRouter from './hello.routes';
import { resolveActiveOrgRole } from '../identity/utils/resolveActiveOrgRole';
import { prisma } from '../../shared/configs/prismaClient.config';

const app = express();
app.use(express.json());
app.use('/api', helloRouter);
app.use(globalErrorHandler);

describe('GET /api/me', () => {
  beforeEach(() => {
    vi.mocked(resolveActiveOrgRole).mockResolvedValue('operator');
    vi.mocked(prisma.platformAdmin.findUnique).mockResolvedValue(null);
  });

  it('sert ce dont les deux clients ont besoin', async () => {
    const res = await request(app).get('/api/me');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      user: {
        id: 'user-1',
        name: 'Olivia Opératrice',
        email: 'operator@nutrichain.local',
        twoFactorEnabled: true,
      },
      activeOrgId: 'org-1',
      role: 'operator',
      isPlatformAdmin: false,
    });
  });

  /**
   * #251 — `session` était sérialisée en entier. Le jeton de session est un CREDENTIAL : le mettre
   * dans un corps JSON annule la garantie `httpOnly` du cookie, et cette réponse part à chaque
   * rendu SSR du front comme à chaque montage de l'app mobile. Tout ce qui capture un corps de
   * réponse — export HAR envoyé au support, rapport de crash, sonde APM — devenait un coffre à
   * sessions utilisables jusqu'à `expiresAt`.
   */
  it('ne laisse jamais fuir le jeton de session dans le corps', async () => {
    const res = await request(app).get('/api/me');

    expect(JSON.stringify(res.body)).not.toContain(JETON);
  });

  it('ne renvoie ni ipAddress ni userAgent', async () => {
    // Le DPIA ne déclare l'adresse IP que pour les journaux applicatifs, pas pour une réponse d'API.
    const res = await request(app).get('/api/me');

    expect(JSON.stringify(res.body)).not.toContain('203.0.113.7');
    expect(JSON.stringify(res.body)).not.toContain('poste de l opérateur');
  });

  it('ne renvoie plus de champ session du tout', async () => {
    // Aucun consommateur n'en lit : ni `MeResponse` côté mobile, ni `hooks.server.ts` côté front.
    // On ne garde donc même pas `expiresAt` — l'ajouter le jour où il servira coûte une ligne.
    const res = await request(app).get('/api/me');

    expect(res.body.data).not.toHaveProperty('session');
  });

  it('ne rejoue pas les champs internes du compte', async () => {
    // `emailVerified`, `image`, `createdAt`, `updatedAt` n'étaient lus par personne : les servir
    // élargit la surface sans usage.
    const res = await request(app).get('/api/me');

    expect(res.body.data.user).not.toHaveProperty('emailVerified');
    expect(res.body.data.user).not.toHaveProperty('createdAt');
  });

  it('signale un administrateur de plateforme', async () => {
    vi.mocked(prisma.platformAdmin.findUnique).mockResolvedValue({ id: 'pa-1' } as never);

    const res = await request(app).get('/api/me');

    expect(res.body.data.isPlatformAdmin).toBe(true);
  });
});
