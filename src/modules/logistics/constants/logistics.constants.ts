/**
 * Constantes métier du domaine Logistics
 *
 * RESPONSABILITÉ:
 * - Centraliser les énumérations de rôles et de statuts (lot, réception)
 * - Servir de source unique de vérité (Single Source of Truth)
 * - Éviter les typos et strings magiques dans le code
 */

// Les rôles ont été unifiés dans le vocabulaire canonique unique :
// `src/modules/identity/constants/roles.constants.ts` (ROLES + *_ROLES).

// ========== STATUTS DE RÉCEPTION ==========
/**
 * Énumération des statuts possibles pour une réception (contrôle qualité).
 */
export const RECEIPT_STATUSES = {
  OK: 'OK',
  ALERT: 'ALERTE',
  NON_CONFORM: 'NONCONFORME',
} as const;

// ========== STATUTS DE LOT ==========
/**
 * Énumération exhaustive des statuts possibles pour un lot (Batch.statut),
 * source unique de vérité. Tout code qui lit/écrit Batch.statut doit passer par ici.
 */
export const BATCH_STATUSES = {
  /** Disponible, peut être transformé / expédié. */
  IN_STOCK: 'EN_STOCK',
  /** En cours de transformation. */
  IN_PRODUCTION: 'EN_PRODUCTION',
  /** Quarantaine qualité : non-conformité au contrôle réception (blocage HACCP). */
  BLOCKED: 'BLOQUE',
  /** Bloqué par un rappel produit ou une excursion chaîne du froid. */
  ALERT: 'ALERTE',
  /** Totalité du lot expédiée. */
  SHIPPED: 'EXPEDIE',
  /** Stock épuisé par consommation/transformation. */
  DEPLETED: 'EPUISE',
} as const;

export type BatchStatus = (typeof BATCH_STATUSES)[keyof typeof BATCH_STATUSES];

/**
 * Statuts bloquant toute opération de sortie (transformation, expédition).
 * Un lot dans l'un de ces états ne doit JAMAIS quitter le stock : c'est la garde
 * sanitaire centrale (non-conformité qualité, rappel, alerte froide).
 */
export const BLOCKING_BATCH_STATUSES: readonly BatchStatus[] = [
  BATCH_STATUSES.BLOCKED,
  BATCH_STATUSES.ALERT,
];

/**
 * Vrai si un lot dans ce statut ne peut pas quitter le stock (transformation/expédition).
 * Centralise le test + le cast string->BatchStatus (Batch.statut est un String Prisma brut).
 */
export function isBatchBlocked(statut: string): boolean {
  return (BLOCKING_BATCH_STATUSES as readonly string[]).includes(statut);
}

/**
 * Contrôles qualité à la réception qui placent immédiatement le lot en quarantaine.
 */
export const QUARANTINE_RECEIPT_CONTROLS: readonly string[] = [
  RECEIPT_STATUSES.NON_CONFORM,
  RECEIPT_STATUSES.ALERT,
];
