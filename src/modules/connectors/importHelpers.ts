/**
 * Types et aides partagés par les imports de connecteurs (produits, tiers…).
 */
import { parseCsv } from '../../shared/utils/csv/csv';

export interface ImportRowResult {
  line: number;
  status: 'created' | 'updated' | 'error';
  ref?: string;
  message?: string;
}

export interface ImportReport {
  total: number;
  created: number;
  updated: number;
  errors: number;
  parseErrors: string[];
  results: ImportRowResult[];
}

/** Extrait un message lisible d'une erreur de validation VineJS (ou autre). */
export function importErrorMessage(err: unknown): string {
  const e = err as { error?: { field: string; message: string }[] };
  if (Array.isArray(e?.error)) {
    return e.error.map((d) => `${d.field}: ${d.message}`).join(' ; ');
  }
  return (err as Error)?.message ?? 'Erreur inconnue';
}

/**
 * Convertit les cellules CSV vides ('') en `undefined` : une cellule vide signifie
 * « valeur absente », ce que VineJS `.optional()` attend (et qui déclenche bien l'erreur
 * « requis » sur un champ obligatoire vide).
 */
export function blankToUndefined(row: Record<string, string>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === '' ? undefined : v]));
}

/**
 * Points de variation d'un import CSV upsert idempotent (un par type de ressource).
 * @template T forme validée d'une ligne (résultat de `validateRow`).
 */
export interface CsvUpsertHandlers<T> {
  /** Valide (et pré-traite) une ligne brute en données typées. Jette si invalide. */
  validateRow: (row: Record<string, string>) => Promise<T>;
  /** Contrôle métier additionnel (ex: FK unité) ; renvoie un message d'erreur ou null si OK. */
  checkRow?: (data: T) => string | null;
  /** Cherche la ligne existante par sa clé d'idempotence (cloisonnée org par l'appelant). */
  findExisting: (data: T) => Promise<{ id: string } | null>;
  update: (id: string, data: T) => Promise<unknown>;
  create: (data: T) => Promise<unknown>;
  /** Référence affichée dans le rapport (clé d'idempotence). */
  refOf: (data: T) => string;
}

/**
 * Exécute un import CSV en succès partiel (une ligne invalide n'annule pas les autres) :
 * parse → validation → contrôle métier optionnel → upsert idempotent, en agrégeant un rapport.
 * Centralise la plomberie commune ; chaque ressource ne fournit que ses points de variation.
 */
export async function runCsvUpsertImport<T>(
  csvText: string,
  handlers: CsvUpsertHandlers<T>
): Promise<ImportReport> {
  const { rows, errors: parseErrors } = parseCsv(csvText);
  const results: ImportRowResult[] = [];
  let created = 0;
  let updated = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const line = i + 1;
    try {
      const data = await handlers.validateRow(rows[i]);

      const checkError = handlers.checkRow?.(data) ?? null;
      if (checkError) {
        results.push({ line, status: 'error', message: checkError });
        errors++;
        continue;
      }

      const existing = await handlers.findExisting(data);
      if (existing) {
        await handlers.update(existing.id, data);
        results.push({ line, status: 'updated', ref: handlers.refOf(data) });
        updated++;
      } else {
        await handlers.create(data);
        results.push({ line, status: 'created', ref: handlers.refOf(data) });
        created++;
      }
    } catch (err) {
      results.push({ line, status: 'error', message: importErrorMessage(err) });
      errors++;
    }
  }

  return { total: rows.length, created, updated, errors, parseErrors, results };
}
