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

  app.use(express.json());

  // CORS — ne concerne que les clients navigateur (Expo Web, back-office web).
  // Les apps natives iOS/Android n'envoient pas d'header Origin : CORS ne s'applique pas à elles.
  // En prod : lister les domaines web autorisés dans FRONTEND_URL (séparés par des virgules).
  // En dev  : on accepte n'importe quelle origine locale pour éviter les conflits de port.
  const allowedWebOrigins = (process.env.FRONTEND_URL || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          // Pas d'Origin = app native, curl, Postman → on laisse passer
          return callback(null, true);
        }
        if (process.env.NODE_ENV !== 'production') {
          // Dev : on accepte toutes les origines (localhost sur n'importe quel port)
          return callback(null, origin);
        }
        // Prod : uniquement les origines web déclarées dans FRONTEND_URL
        if (allowedWebOrigins.includes(origin)) {
          return callback(null, origin);
        }
        callback(new Error(`Origine non autorisée par CORS : ${origin}`));
      },
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-org-id'],
      exposedHeaders: ['Content-Length'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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

  const limiter = createRateLimiter(15, 100);
  app.use(limiter);

  app.use(sanitizeRequestData);

  app.use((req, res, next) => {
    rotateLog();
    requestLog(req, res, next);

    logger.info(` ${req.method} - ${req.url} - IP:  ${req.ip}`);
  });
};

// ! EXPORT
export default configureMiddleware;
