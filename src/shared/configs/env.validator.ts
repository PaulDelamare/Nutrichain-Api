export const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'API_KEY',
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
