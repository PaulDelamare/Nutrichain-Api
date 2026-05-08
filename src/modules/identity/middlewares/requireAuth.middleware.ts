import { Request, Response, NextFunction } from 'express';
import { auth } from '../auth.config';

/**
 * Middleware qui intercepte la requête, vérifie si l'utilisateur est authentifié via `better-auth`.
 * Si oui, ajoute l'utilisateur (user) et sa session dans `req.user` et `req.session`.
 * Sinon, bloque la requête en retournant 401 Unauthorized.
 */
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // En Express, pour Better Auth on passe le req et res à api.getSession
    // Les Headers Nodejs IncomingHttpHeaders diffèrent du type standard Web Headers.
    const sessionPayload = await auth.api.getSession({
      headers: new Headers(req.headers as unknown),
    });

    if (!sessionPayload || !sessionPayload.session) {
      res.status(401).json({
        status: 401,
        message: 'Accès refusé. Veuillez vous authentifier.',
      });
      return;
    }

    // On stocke les infos pour les utiliser dans les controllers
    (req as unknown).user = sessionPayload.user;
    (req as unknown).session = sessionPayload.session;

    next();
  } catch (error) {
    console.error('[Auth Middleware Error]', error);
    res.status(500).json({
      status: 500,
      message: "Erreur interne lors de la vérification de l'authentification",
    });
  }
};
