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

/**
 * Variables qui portent un secret : leur VALEUR compte, pas seulement leur présence.
 */
const SECRET_ENV_VARS = ['BETTER_AUTH_SECRET', 'API_KEY', 'IOT_API_KEY'] as const;

/**
 * Valeurs publiées dans ce dépôt : `.env.demo` (pile de démonstration) et les marqueurs de
 * `.env.example`. Elles ne sont un secret pour personne.
 *
 * Vérifier la seule PRÉSENCE d'un secret ne suffisait pas (#248) : `cp .env.example .env` remplit
 * les trois variables avec ces marqueurs, et le démarrage passait. Or `BETTER_AUTH_SECRET` signe
 * les cookies de session — connu, il rend les sessions forgeables — et `IOT_API_KEY` ouvre
 * l'ingestion capteurs, donc le déclenchement ou l'étouffement d'alertes froid.
 */
const PUBLISHED_SECRET_VALUES = new Set([
  'secret-de-demo-docker-32-caracteres-minimum',
  'cle-api-de-demo-docker-a-remplacer-en-production',
  'cle-capteurs-de-demo-docker-a-remplacer-en-production',
  'a-generer-voir-ci-dessus',
  'a-generer-comme-ci-dessus-mais-DIFFERENTE',
  'un-vrai-secret-genere-automatiquement-en-production-32-cars',
]);

export function assertEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  // La démonstration locale reste possible, mais elle se DÉCLARE — `.env.demo` pose ce drapeau.
  // Sans lui, tourner avec des secrets publiés n'est plus quelque chose qu'on obtient par défaut.
  if (process.env.ALLOW_DEMO_SECRETS === '1') {
    return;
  }

  const published = SECRET_ENV_VARS.filter((key) =>
    PUBLISHED_SECRET_VALUES.has(process.env[key] ?? '')
  );
  if (published.length > 0) {
    throw new Error(
      `Secrets publiés dans le dépôt, donc inutilisables : ${published.join(', ')}. ` +
        'Générez-en de vrais (`openssl rand -base64 32`), ou lancez la démonstration locale avec ' +
        '`docker compose --env-file .env.demo up --build`.'
    );
  }
}
