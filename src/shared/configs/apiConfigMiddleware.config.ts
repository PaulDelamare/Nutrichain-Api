// ! IMPORTS
import express, { Request } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import * as dotenv from 'dotenv';
import { requestLog, rotateLog } from '../utils/logFunction/logFunction';
import { redactUrl } from '../utils/logFunction/redactUrl';
import { logger } from '../utils/logger/logger';
import createRateLimiter from '../middlewares/rateLimiter/rateLimiter.middleware';
import { sanitizeRequestData } from '../middlewares/sanitizeData/sanitizeData.middleware';
import { requestIdMiddleware } from '../middlewares/requestId.middleware';
import { resolveTrustedOrigins } from './trustedOrigins.config';
import { requestMetricsMiddleware } from '../../modules/observability/middlewares/requestMetrics.middleware';

// ! FONCTION

/**
 * Configue Middleware for an express application
 *
 * @param app - The Express application instance to configure middleware for.
 *
 * The function sets up various middleware functionalities including:
 * - Parsing incoming request bodies as JSON.
 * - Enabling CORS for the API.
 * - Securing the API with Helmet.
 * - Compressing the response body with specific filter conditions.
 * - Trusting proxy settings for certain network interfaces.
 * - Limiting the number of requests per window via a rate limiter.
 * - Sanitizing request data to prevent malicious input.
 * - Logging and rotating logs for incoming requests, including method, URL, and IP information.
 */

const configureMiddleware = (app: express.Application) => {
  dotenv.config();

  app.use(requestIdMiddleware);

  app.use(express.json());

  app.use(
    cors({
      origin: resolveTrustedOrigins(),
      credentials: true,
    })
  );

  app.use(helmet());

  app.use(
    compression({
      threshold: 1024,
      filter: (req: Request) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return !req.path.match(/\.(jpg|jpeg|png|gif|pdf|svg|mp4)$/i);
      },
    })
  );

  // `trust proxy` décide à qui Express fait confiance pour recalculer `req.ip` depuis
  // `X-Forwarded-For`. La valeur précédente — `['loopback', 'linklocal', 'uniquelocal']` — déclarait
  // de confiance TOUT l'espace privé RFC1918, alors qu'aucun reverse proxy ne figure dans la pile
  // livrée (docker-compose publie l'API directement). L'en-tête venait donc de l'appelant, et
  // `req.ip` devenait une valeur qu'il choisissait (#247).
  //
  // Les limiteurs comptent par `req.ip` (aucun `keyGenerator`) : faire varier l'en-tête suffisait
  // à obtenir un compteur neuf à chaque requête, donc à annuler le limiteur anti-bruteforce. Les
  // journaux de `logs/` traçaient au passage l'adresse choisie par l'appelant — une règle SIEM qui
  // compte les échecs par IP en devenait trompeuse.
  //
  // Par défaut on ne fait donc confiance à personne. Le jour où un ingress est réellement placé
  // devant, `TRUST_PROXY_HOPS` déclare le nombre de sauts à remonter : la confiance se choisit,
  // elle ne se subit pas. Un espace d'adresses entier n'est jamais la bonne réponse.
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS) || 0;
  app.set('trust proxy', trustProxyHops > 0 ? trustProxyHops : false);

  // 100/15 min était trop bas : une seule page front déclenche ~5 appels en
  // parallèle (SSR) → un usage normal se faisait 429. Défaut confortable pour
  // l'interactif, resserrable en prod via RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MIN.
  const rateWindowMin = Number(process.env.RATE_LIMIT_WINDOW_MIN) || 15;
  const rateMax = Number(process.env.RATE_LIMIT_MAX) || 1000;
  const limiter = createRateLimiter(rateWindowMin, rateMax);
  app.use(limiter);

  app.use(sanitizeRequestData);

  app.use(requestMetricsMiddleware);

  app.use((req, res, next) => {
    rotateLog();
    requestLog(req, res, next);

    // `redactUrl` masque les segments de chemin qui portent un secret (#253) : le jeton
    // d'invitation partait sinon dans `logs/app-*.log`, sur la console, et jusqu'au SIEM — où il
    // suffisait à devenir membre au rôle invité, sans aucune session.
    logger.info(`${req.method} - ${redactUrl(req.url)} - IP: ${req.ip}`, {
      requestId: req.requestId,
    });
  });
};

// ! EXPORT
export default configureMiddleware;
