import { NextFunction, Request, Response } from 'express';
import { recordRequestSample } from './metricsStore';
import { AuthenticatedRequest } from '../../identity/types/auth.types';

/**
 * `req.route?.path` n'est peuplé qu'après la résolution du routeur : on le lit dans le listener
 * `finish`, pas au début du middleware. Une route non résolue (404) n'est PAS enregistrée — sinon
 * n'importe quel appelant non authentifié ferait grossir indéfiniment le nombre de clés suivies en
 * tapant des chemins arbitraires (`metricsStore` ne peut borner que ce qu'on lui donne à borner).
 *
 * `req.activeOrgId` est lu au même moment : `requireOrgRole` l'a déjà posé sur `req` si la route en
 * dépend, avant que le controller ne réponde et que `finish` ne se déclenche.
 */
export const requestMetricsMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    if (!req.route?.path) {
      return;
    }

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    recordRequestSample({
      route: req.route.path,
      method: req.method,
      statusCode: res.statusCode,
      durationMs,
      organizationId: (req as AuthenticatedRequest).activeOrgId ?? null,
      timestamp: Date.now(),
    });
  });

  next();
};
