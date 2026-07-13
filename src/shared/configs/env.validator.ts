export const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  /** Identifie l'application appelante (mobile, front). PUBLIQUE : elle n'autorise aucune action. */
  'API_KEY',
  /**
   * Authentifie les capteurs. VRAI SECRET, à ne jamais livrer à un client : une trame de
   * télémétrie met des lots en quarantaine et lève une alerte — elle décide, elle ne décrit pas.
   */
  'IOT_API_KEY',
  'API_KEY_ORG_ID',
  'API_URL',
  'FRONTEND_URL',
  'MONGO_URI',
  'BETTER_AUTH_SECRET',
] as const;

export function assertEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}
