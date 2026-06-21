import Papa from 'papaparse';

export interface CsvParseResult {
  rows: Record<string, string>[];
  errors: string[];
}

/**
 * Parse un CSV (avec en-tête) en lignes objets, via papaparse (gère correctement le quoting,
 * les virgules et retours-ligne échappés). En-têtes et cellules sont trimés.
 * Les erreurs de parsing sont remontées sans jeter (l'appelant décide quoi en faire).
 */
export function parseCsv(text: string): CsvParseResult {
  const result = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  });
  const errors = result.errors.map(
    (e) => `ligne ${typeof e.row === 'number' ? e.row + 1 : '?'} : ${e.message}`
  );
  return { rows: result.data, errors };
}

/**
 * Sérialise des lignes objets en CSV (en-tête = `columns`, dans l'ordre fourni).
 * Le quoting est géré par papaparse.
 */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  return Papa.unparse(
    rows.map((r) => r),
    { columns }
  );
}
