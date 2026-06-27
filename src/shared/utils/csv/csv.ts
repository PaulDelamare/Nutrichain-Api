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
 * Neutralise l'injection de formule CSV : une cellule texte commençant par `= + - @`
 * (ou tab/CR) est interprétée comme une formule par Excel/LibreOffice à l'ouverture.
 * On la préfixe d'une apostrophe pour forcer son interprétation comme texte (OWASP).
 */
function neutralizeFormulaInjection(value: unknown): unknown {
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

/**
 * Sérialise des lignes objets en CSV (en-tête = `columns`, dans l'ordre fourni).
 * Le quoting est géré par papaparse ; les valeurs sont protégées contre l'injection de formule.
 */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const safeRows = rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, neutralizeFormulaInjection(v)]))
  );
  return Papa.unparse(safeRows, { columns });
}
