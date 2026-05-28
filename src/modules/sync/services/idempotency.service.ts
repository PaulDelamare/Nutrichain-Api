import crypto from 'crypto';

/**
 * Helpers d'idempotency pour le bulk sync mobile.
 *
 * **Note volontaire** : ce fichier ne contient PAS de CRUD sur la table `IdempotencyKey`.
 * Les opérations DB (findUnique, create, update) restent inline dans `syncScansService.processItem`
 * pour rester dans la transaction atomique unique (claim + receipt + audit). Re-ajouter du CRUD
 * ici romprait l'atomicité.
 *
 * Seuls les calculs purs (hash canonical du payload) vivent ici. Les constantes (TTL, rôles)
 * sont dans `sync.constants.ts`.
 */
export const idempotencyService = {
  /**
   * Calcule un SHA256 hex stable d'un payload, après normalisation par tri récursif
   * des clés. Garantit que { a:1, b:2 } et { b:2, a:1 } produisent le même hash.
   */
  hashPayload(payload: unknown): string {
    const canonical = canonicalStringify(payload);
    return crypto.createHash('sha256').update(canonical).digest('hex');
  },
};

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(obj[k])).join(',') + '}'
  );
}
