/**
 * Types et aides partagés par les imports de connecteurs (produits, tiers…).
 */

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
