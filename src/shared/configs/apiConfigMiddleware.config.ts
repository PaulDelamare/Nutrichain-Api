// ! IMPORTS
import express, { Request } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import * as dotenv from 'dotenv';
import { requestLog, rotateLog } from '../utils/logFunction/logFunction';
import { logger } from '../utils/logger/logger';
import createRateLimiter from '../middlewares/rateLimiter/rateLimiter.middleware';
import { sanitizeRequestData } from '../middlewares/sanitizeData/sanitizeData.middleware';
import { requestIdMiddleware } from '../middlewares/requestId.middleware';
import { resolveTrustedOrigins } from './trustedOrigins.config';

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

  app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);

  // 100/15 min était trop bas : une seule page front déclenche ~5 appels en
  // parallèle (SSR) → un usage normal se faisait 429. Défaut confortable pour
  // l'interactif, resserrable en prod via RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MIN.
  const rateWindowMin = Number(process.env.RATE_LIMIT_WINDOW_MIN) || 15;
  const rateMax = Number(process.env.RATE_LIMIT_MAX) || 1000;
  const limiter = createRateLimiter(rateWindowMin, rateMax);
  app.use(limiter);

  app.use(sanitizeRequestData);

  app.use((req, res, next) => {
    rotateLog();
    requestLog(req, res, next);

    logger.info(`${req.method} - ${req.url} - IP: ${req.ip}`, { requestId: req.requestId });
  });
};

// ! EXPORT
export default configureMiddleware;
