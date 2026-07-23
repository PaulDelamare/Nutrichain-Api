/**
 * Référentiel canonique des unités de mesure — SOURCE UNIQUE DE VÉRITÉ.
 *
 * `Batch.unite_code` est une clé étrangère vers `Unit.code` : la table `Unit` DOIT contenir
 * exactement ces codes, ni plus ni moins. Le seed la peuple depuis cette liste, et `VALID_UNITS`
 * en dérive pour la validation. Toute divergence casse : un lot en `KG` alors que la table n'a que
 * `kg` violait la FK (500), une transformation en `ML` était refusée. Une seule liste, ici.
 *
 * Casse canonique : MAJUSCULES. Les codes ne sont PAS les codes UN/CEFACT-GS1 (`KGM`, `LTR`) — la
 * correspondance GS1 stricte et la conversion entre unités (`factor_to_base`) relèvent d'un autre
 * chantier ; ici on garantit seulement que le référentiel est cohérent d'un bout à l'autre.
 */
export const UNITS = [
  { code: 'KG', nom: 'Kilogrammes' },
  { code: 'G', nom: 'Grammes' },
  { code: 'L', nom: 'Litres' },
  { code: 'ML', nom: 'Millilitres' },
  { code: 'UNIT', nom: 'Unités' },
  { code: 'PALLET', nom: 'Palettes' },
  { code: 'BOX', nom: 'Cartons' },
] as const;

export const VALID_UNITS = UNITS.map((u) => u.code) as [string, ...string[]];

/**
 * Normalise un code d'unité saisi : le référentiel est strict en STOCKAGE (une seule casse en base)
 * mais tolérant en ENTRÉE. `kg`, `Kg`, ` kg ` deviennent tous `KG`. Un ERP ou un client qui n'a pas
 * la casse exacte n'est pas rejeté pour un détail de forme.
 */
export function normalizeUnitCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Vrai si `raw`, une fois normalisé, appartient au référentiel. */
export function isValidUnit(raw: string): boolean {
  return (VALID_UNITS as readonly string[]).includes(normalizeUnitCode(raw));
}
