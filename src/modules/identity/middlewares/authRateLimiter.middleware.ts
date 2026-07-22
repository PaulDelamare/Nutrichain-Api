import rateLimit from 'express-rate-limit';

/** Tentatives ÉCHOUÉES tolérées par adresse IP sur les routes d'authentification. */
const MAX_FAILED_PER_IP = 20;
const WINDOW_MINUTES = 15;

/**
 * Limiteur dédié aux routes d'authentification.
 *
 * Le limiteur global (1000 requêtes / 15 min) est calibré pour l'interactif : il ne freine aucune
 * attaque par dictionnaire. Celui-ci ne compte que les tentatives ÉCHOUÉES
 * (`skipSuccessfulRequests`), ce qui le rend serré sans gêner un usage normal — une équipe derrière
 * une même IP publique peut se connecter autant qu'elle veut tant qu'elle y arrive.
 *
 * Il complète le verrou par compte (`loginThrottle`) : celui-ci freine le balayage de nombreux
 * comptes depuis une source, l'autre l'acharnement sur un compte depuis plusieurs sources.
 */
export const authRateLimiter = rateLimit({
  windowMs: WINDOW_MINUTES * 60 * 1000,
  max: MAX_FAILED_PER_IP,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      status: 429,
      error: [
        {
          field: 'auth',
          message: 'Trop de tentatives de connexion depuis cette adresse. Réessayez plus tard.',
        },
      ],
    });
  },
});
