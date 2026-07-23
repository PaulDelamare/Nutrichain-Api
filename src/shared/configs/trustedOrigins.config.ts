/**
 * Origines navigateur de confiance, source unique pour CORS et Better-Auth.
 *
 * Les deux devaient rester alignes : une origine acceptee par CORS mais absente
 * de `trustedOrigins` passe le preflight puis se fait rejeter en « Invalid origin »
 * par Better-Auth. Le mode web d'Expo (`expo start --web`, port 8081) et tout autre
 * front se declarent via `ADDITIONAL_TRUSTED_ORIGINS` (liste separee par des virgules),
 * jamais en dur.
 */
export function resolveTrustedOrigins(): string[] {
  const origins = [process.env.FRONTEND_URL || 'http://localhost:5173'];

  // vite preview (e2e Playwright du front) sert le build sur 4173 — hors production.
  if (process.env.NODE_ENV !== 'production') {
    origins.push('http://localhost:4173');
  }

  const additional = (process.env.ADDITIONAL_TRUSTED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return [...new Set([...origins, ...additional])];
}
