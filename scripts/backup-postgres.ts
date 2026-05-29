/**
 * Backup Postgres via `pg_dump` (Objectif SMART n°7 — PCA/PRA).
 *
 * Lancement : `npm run backup:postgres`.
 *
 * Requiert le binaire `pg_dump` installé localement (côté ops). Le format de
 * sortie est `custom` (compressé, restorable via `pg_restore`).
 *
 * Le path d'output est horodaté : `<BACKUP_DIR>/postgres-YYYYMMDD-HHmmss.dump`.
 * `BACKUP_DIR` défaut : `./backups`.
 */
import { execFileSync as defaultExec } from 'node:child_process';
import { mkdirSync as defaultMkdir } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BuildArgsResult {
  outFile: string;
  args: string[];
}

export function buildPgDumpArgs(
  databaseUrl: string,
  backupDir: string,
  now: Date = new Date()
): BuildArgsResult {
  const stamp = now
    .toISOString()
    .replace(/[-:T]/g, '')
    .replace(/\..+$/, '');
  const outFile = path.join(backupDir, `postgres-${stamp}.dump`);
  // -Fc : format custom (restorable + compressed), -d : connection string
  const args = ['-Fc', '-f', outFile, '-d', databaseUrl];
  return { outFile, args };
}

export interface BackupDeps {
  exec?: typeof defaultExec;
  mkdir?: typeof defaultMkdir;
  log?: (msg: string) => void;
  now?: () => Date;
}

export function runBackupPostgres(deps: BackupDeps = {}): string {
  const exec = deps.exec ?? defaultExec;
  const mkdir = deps.mkdir ?? defaultMkdir;
  const log = deps.log ?? ((m: string) => console.log(m));
  const now = deps.now ?? (() => new Date());

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL manquant — impossible de lancer pg_dump.');
  }
  const backupDir = process.env.BACKUP_DIR ?? './backups';
  mkdir(backupDir, { recursive: true });

  const { outFile, args } = buildPgDumpArgs(databaseUrl, backupDir, now());
  log(`[backup-postgres] Démarrage pg_dump → ${outFile}`);
  exec('pg_dump', args, { stdio: 'inherit' });
  log(`[backup-postgres] OK — ${outFile}`);
  return outFile;
}

// Run automatiquement si exécuté directement (compatible ESM).
const isMain =
  typeof process.argv[1] === 'string' &&
  process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    runBackupPostgres();
  } catch (e) {
    console.error('[backup-postgres] Échec :', (e as Error).message);
    process.exit(1);
  }
}
