/**
 * Backup MongoDB via `mongodump` (Objectif SMART n°7 — PCA/PRA).
 *
 * Lancement : `npm run backup:mongo`.
 *
 * Requiert le binaire `mongodump` installé localement (côté ops). Le format de
 * sortie est `archive` (single file, compressible).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  console.error('[backup-mongo] MONGO_URI manquant.');
  process.exit(1);
}
const backupDir = process.env.BACKUP_DIR ?? './backups';
mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[-:T]/g, '').replace(/\..+$/, '');
const outFile = path.join(backupDir, `mongo-${stamp}.archive`);

console.log(`[backup-mongo] Démarrage mongodump → ${outFile}`);
try {
  execFileSync('mongodump', [`--uri=${mongoUri}`, `--archive=${outFile}`, '--gzip'], {
    stdio: 'inherit',
  });
  console.log(`[backup-mongo] OK — ${outFile}`);
} catch (e) {
  console.error('[backup-mongo] Échec :', (e as Error).message);
  process.exit(1);
}
