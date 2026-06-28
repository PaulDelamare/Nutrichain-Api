// ! IMPORTS
import rateLimit from 'express-rate-limit';

// ! FONCTIONS

/**
 * Creates an Express middleware to limit the number of requests in a given time window.
 *
 * @param {number} minutes - The time window in minutes.
 * @param {number} maxRequests - The maximum number of requests allowed in the window.
 *
 * @returns {RequestHandler} - The Express middleware.
 */
function createRateLimiter(minutes: number, maxRequests: number) {
  const isDev = process.env.NODE_ENV === 'development';

  return rateLimit({
    windowMs: minutes * 60 * 1000,

    max: maxRequests,

    standardHeaders: true,
    legacyHeaders: false,

    skip: (req) => {
      if (isDev) return true;
      return req.path === '/health' || req.path === '/api/health';
    },

    /**
     * Function to handle requests that exceed the rate limit.
     *
     * @param {Request} req - The request object
     * @param {Response} res - The response object
     */
    handler: (req, res) => {
      res.status(429).json({
        status: 429,
        error: [
          {
            field: 'rate-limit',
            message: 'Trop de requêtes, veuillez réessayer plus tard.',
          },
        ],
      });
    },
  });
}

// ! EXPORT
export default createRateLimiter;
