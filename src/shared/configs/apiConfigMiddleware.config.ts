// ! IMPORTS
import express, { Request } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ quiet: true });

  app.use(express.json());

  app.use(cors());

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
