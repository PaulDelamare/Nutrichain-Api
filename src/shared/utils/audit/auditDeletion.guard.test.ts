import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

/**
 * #291 — Un nettoyage qui supprime QUELQUES maillons d'audit rompt la chaîne pour toute
 * l'organisation : elle est chaînée par hash, retirer une ligne au milieu casse le `prev_hash` de
 * la suivante. Le bouton « vérifier l'intégrité » affiche alors ce qui ressemble à une
 * falsification, et un observateur ne fait pas la différence.
 *
 * L'invariant : **on ne supprime jamais une PARTIE d'une chaîne.** Effacer l'intégralité d'une
 * organisation jetable créée par le test est inoffensif — la chaîne part en entier, rien ne pend.
 * Filtrer en plus sur `entity_id`, `action` ou un `id` ampute au milieu.
 *
 * ## Ce que ce test NE prouve PAS
 *
 * Il lit du texte : c'est une aide à la relecture, pas une garantie. Une relecture adversariale a
 * exhibé les contournements suivants, assumés :
 * - `const t = prisma.audit_Log; t.deleteMany(...)` — le verbe et la table sont sur deux lignes ;
 * - une suppression déplacée dans une dépendance hors de ces répertoires ;
 * - une cascade `onDelete` ajoutée au schéma.
 *
 * La garantie réelle serait de **retirer le droit `DELETE` sur `Audit_Log` au rôle applicatif**.
 * Écarté ici, et pas par confort : `Audit_Log.organization` est en `onDelete: Restrict`, donc
 * supprimer une organisation jetable EXIGE de supprimer ses maillons d'abord. Un `REVOKE` casserait
 * les sept nettoyages légitimes. Le vrai correctif de fond serait que les scénarios cessent de
 * créer des organisations — autre chantier.
 */

const ROOTS = [
  path.resolve(__dirname, '../../../../scripts'),
  path.resolve(__dirname, '../../../../src'),
];

/** Un filtre qui cite l'un de ces champs ne peut pas viser une chaîne entière. */
const PARTIAL_FILTER_FIELDS = ['entity_id', 'entity', 'action', 'horodatage', 'signature_hash'];

/** Déclaration explicite exigée quand le filtre n'est pas une organisation entière. */
const JUSTIFICATION_MARKER = 'chaîne jetable';

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectSourceFiles(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Toutes les formes de suppression d'un maillon, y compris le SQL brut et le `delete` singulier. */
function isAuditDeletion(line: string): boolean {
  const stripped = line.trim();
  // Une ligne commentée documente, elle ne supprime pas. Sans ça, écrire la règle en commentaire
  // dans un script faisait rougir la CI.
  if (stripped.startsWith('//') || stripped.startsWith('*')) return false;

  const mentionsAudit = /audit_Log|"Audit_Log"/i.test(line);
  const deletes = /\bdeleteMany\b|\bdelete\s*\(|\[['"]delete/i.test(line) || /DELETE\s+FROM/i.test(line);
  return mentionsAudit && deletes;
}

/**
 * L'instruction de suppression, et elle seule. On s'arrête à sa fin plutôt que de prendre une
 * fenêtre de lignes fixe : celle-ci débordait sur l'instruction suivante et y attrapait le `id:`
 * d'un `organization.delete`, ce qui faisait rougir des suppressions parfaitement saines.
 */
function readStatement(lines: string[], index: number): string {
  const collected: string[] = [];
  for (let i = index; i < Math.min(index + 6, lines.length); i++) {
    collected.push(lines[i]);
    if (/\);|`\s*$|`\)/.test(lines[i]) && i > index) break;
    if (i === index && /\);|`\s*\)?;?\s*$/.test(lines[i])) break;
  }
  return collected.join(' ');
}

/** Le filtre vise-t-il une chaîne ENTIÈRE, c'est-à-dire une organisation et rien de plus ? */
function targetsWholeChain(lines: string[], index: number): boolean {
  const statement = readStatement(lines, index);
  if (!/organization_id/.test(statement)) return false;
  if (PARTIAL_FILTER_FIELDS.some((field) => new RegExp(`\\b${field}\\b`).test(statement))) {
    return false;
  }
  // Un `id` résiduel, une fois les noms de colonnes et les variables écartés, signale une
  // suppression ciblée (`WHERE id = ...`).
  const withoutKnownIds = statement.replace(/\w*organization_id|\w+_id|\w+Id\b/g, '');
  return !/\bid\s*[:=]/.test(withoutKnownIds);
}

function hasJustification(lines: string[], index: number): boolean {
  return lines
    .slice(Math.max(0, index - 5), index)
    .some((line) => line.includes(JUSTIFICATION_MARKER));
}

describe('suppression de maillons d’audit (#291)', () => {
  const files = ROOTS.flatMap((root) => collectSourceFiles(root));

  it('balaie bien les deux arborescences, sous-répertoires compris', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.includes(`helpers${path.sep}`))).toBe(true);
  });

  it('ne supprime jamais une PARTIE d’une chaîne sans le déclarer', () => {
    const violations: string[] = [];

    for (const file of files) {
      if (file.endsWith('auditDeletion.guard.test.ts')) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (!isAuditDeletion(line)) return;
        if (targetsWholeChain(lines, index) || hasJustification(lines, index)) return;
        violations.push(
          `${path.basename(file)}:${index + 1} — supprime une partie d'une chaîne sans « ${JUSTIFICATION_MARKER} » : ${line.trim()}`
        );
      });
    }

    expect(violations, `\n${violations.join('\n')}\n`).toEqual([]);
  });
});
