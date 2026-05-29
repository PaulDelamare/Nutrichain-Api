/**
 * Restore Postgres via `pg_restore` (Objectif SMART n°7 — PCA/PRA).
 *
 * Garde-fous (3/3 reviewers en accord) :
 * - Refuse si `NODE_ENV === 'production'` sauf `RESTORE_ALLOW_PROD=YES`.
 * - Exige `RESTORE_CONFIRM_DB=<dbname>` matchant exactement le dbname parsé
 *   depuis `DATABASE_URL`. Sans confirmation explicite, refuse.
 * - Affiche host + dbname sur stdout AVANT toute action (visibilité ops).
 *
 * Usage :
 *   RESTORE_CONFIRM_DB=nutrichain npm run restore:postgres ./backups/postgres-XYZ.dump
 */
import { execFileSync as defaultExec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface ParsedDbUrl {
  host: string;
  dbname: string;
}

export function parseDatabaseUrl(url: string): ParsedDbUrl {
  // postgresql://user:pass@host:port/dbname?query
  // Robustesse minimale : on lit la dernière partie du path comme dbname.
  const u = new URL(url);
  const dbname = u.pathname.replace(/^\//, '').split('?')[0];
  if (!dbname) {
    throw new Error('DATABASE_URL invalide : impossible de parser le dbname.');
  }
  return { host: u.hostname, dbname };
}

export type RestoreEnv = NodeJS.ProcessEnv;

export class RestoreSafetyError extends Error {}

export function assertRestoreSafety(env: RestoreEnv, parsed: ParsedDbUrl): void {
  if (env.NODE_ENV === 'production' && env.RESTORE_ALLOW_PROD !== 'YES') {
    throw new RestoreSafetyError(
      "Restore refusé en production sans RESTORE_ALLOW_PROD=YES."
    );
  }
  if (!env.RESTORE_CONFIRM_DB) {
    throw new RestoreSafetyError(
      `Restore refusé : RESTORE_CONFIRM_DB requis (attendu '${parsed.dbname}').`
    );
  }
  if (env.RESTORE_CONFIRM_DB !== parsed.dbname) {
    throw new RestoreSafetyError(
      `Restore refusé : RESTORE_CONFIRM_DB='${env.RESTORE_CONFIRM_DB}' ne matche pas le dbname parsé '${parsed.dbname}'.`
    );
  }
}

export interface RestoreDeps {
  exec?: typeof defaultExec;
  log?: (msg: string) => void;
  env?: RestoreEnv;
}

export function runRestorePostgres(dumpPath: string, deps: RestoreDeps = {}): void {
  const exec = deps.exec ?? defaultExec;
  const log = deps.log ?? ((m: string) => console.log(m));
  const env = deps.env ?? process.env;

  if (!dumpPath) {
    throw new RestoreSafetyError('Aucun fichier de dump fourni. Usage : restore:postgres <path>');
  }
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new RestoreSafetyError('DATABASE_URL manquant.');
  }
  const parsed = parseDatabaseUrl(databaseUrl);
  log(`[restore-postgres] Cible : host=${parsed.host} dbname=${parsed.dbname}`);
  assertRestoreSafety(env, parsed);

  exec('pg_restore', ['--clean', '--if-exists', '-d', databaseUrl, dumpPath], {
    stdio: 'inherit',
  });
  log(`[restore-postgres] OK — dump appliqué : ${dumpPath}`);
}

const isMain =
  typeof process.argv[1] === 'string' &&
  process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const dumpPath = process.argv[2];
  try {
    runRestorePostgres(dumpPath);
  } catch (e) {
    console.error('[restore-postgres] Échec :', (e as Error).message);
    process.exit(1);
  }
}
