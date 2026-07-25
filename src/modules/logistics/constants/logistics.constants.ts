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
  /**
   * Produit fini sorti de transformation : il attend son contrôle qualité de sortie d'usine.
   * Barrière HACCP : rien ne quitte l'usine sans qu'un contrôle l'ait libéré.
   */
  PENDING_QC: 'EN_ATTENTE_QC',
  /** Quarantaine : non-conformité au contrôle (réception ou sortie) OU excursion chaîne du froid. Levable. */
  BLOCKED: 'BLOQUE',
  /** Bloqué par un rappel produit. Irréversible. */
  ALERT: 'ALERTE',
  /** Totalité du lot expédiée. */
  SHIPPED: 'EXPEDIE',
  /** Stock épuisé par consommation/transformation. */
  DEPLETED: 'EPUISE',
  /** Détruit (mise au rebut) : plus aucune quantité aux livres, décision tracée. Terminal. */
  SCRAPPED: 'REBUT',
} as const;

export type BatchStatus = (typeof BATCH_STATUSES)[keyof typeof BATCH_STATUSES];

/**
 * Statuts bloquant toute opération de sortie (transformation, expédition).
 * Un lot dans l'un de ces états ne doit JAMAIS quitter le stock : c'est la garde
 * sanitaire centrale (non-conformité qualité, rappel, alerte froide, attente de contrôle).
 */
export const BLOCKING_BATCH_STATUSES: readonly BatchStatus[] = [
  BATCH_STATUSES.PENDING_QC,
  BATCH_STATUSES.BLOCKED,
  BATCH_STATUSES.ALERT,
];

/**
 * Statuts d'un lot qui DORT en stock et qu'une excursion thermique doit mettre en quarantaine.
 * ⚠️ Ne jamais filtrer sur `= EN_STOCK` seul : un lot en attente de contrôle qualité est
 * physiquement dans le frigo, il subit l'excursion comme les autres. L'oublier le laisserait
 * sortir plus tard sur un contrôle conforme, sans qu'aucune trace ne dise qu'il a chauffé.
 */
export const COLD_QUARANTINABLE_STATUSES: readonly BatchStatus[] = [
  BATCH_STATUSES.IN_STOCK,
  BATCH_STATUSES.PENDING_QC,
];

/**
 * Vrai si un lot dans ce statut ne peut pas quitter le stock (transformation/expédition).
 * Centralise le test + le cast string->BatchStatus (Batch.statut est un String Prisma brut).
 */
export function isBatchBlocked(statut: string): boolean {
  return (BLOCKING_BATCH_STATUSES as readonly string[]).includes(statut);
}

// ========== MOUVEMENTS DE LOT ==========
/**
 * Étapes de la vie d'un lot, tracées dans `Batch_Mouvement` (append-only).
 *
 * C'est la source UNIQUE de l'historique affiché (la frise de la fiche lot). L'audit WORM
 * journalise les mêmes décisions, mais il sert de PREUVE d'intégrité, pas d'historique métier :
 * mélanger les deux afficherait chaque étape en double, avec deux horloges différentes.
 *
 * Note : pour un changement de statut (quarantaine, levée, rappel), `quantite`/`unite` portent
 * la quantité du lot CONCERNÉE par la décision — ce n'est pas un mouvement de matière.
 */
// ========== CONTRÔLE QUALITÉ ==========
/**
 * Résultat d'un contrôle qualité. `QualityControl.resultat` est un String libre en base :
 * ces valeurs sont la seule source de vérité, et elles PILOTENT le statut du lot.
 */
export const QUALITY_RESULTS = {
  CONFORM: 'CONFORME',
  NON_CONFORM: 'NON_CONFORME',
} as const;

export type QualityResult = (typeof QUALITY_RESULTS)[keyof typeof QUALITY_RESULTS];

export const QUALITY_RESULT_VALUES = Object.values(QUALITY_RESULTS) as readonly string[];

export const MOVEMENT_TYPES = {
  RECEPTION: 'RECEPTION',
  QUALITY_CONTROL: 'CONTROLE_QUALITE',
  TRANSFORMATION_IN: 'TRANSFORMATION_ENTREE',
  TRANSFORMATION_OUT: 'TRANSFORMATION_SORTIE',
  SHIPMENT: 'EXPEDITION',
  COLD_QUARANTINE: 'QUARANTAINE_FROID',
  QUARANTINE_LIFTED: 'LEVEE_QUARANTAINE',
  RECALL: 'RAPPEL',
  MOVE: 'DEPLACEMENT',
  SCRAP: 'MISE_AU_REBUT',
} as const;

/**
 * Statuts d'un lot qu'on peut RANGER ailleurs. Un lot en quarantaine (`BLOQUE`) ou sous rappel
 * (`ALERTE`) est immobilisé : le déplacer casserait la surveillance de l'incident — un lot `BLOQUE`
 * déplacé n'est plus jamais re-mis en quarantaine froid (`COLD_QUARANTINABLE_STATUSES` ne le contient
 * pas) et ressortirait `EN_STOCK` dans un frigo en panne à la levée. `EXPEDIE`/`EPUISE` ne sont plus
 * là physiquement. Seul un lot librement disponible bouge.
 */
export const MOVABLE_BATCH_STATUSES: readonly BatchStatus[] = [
  BATCH_STATUSES.IN_STOCK,
  BATCH_STATUSES.PENDING_QC,
];

/**
 * Statuts sans autre issue que la destruction : un lot sous rappel (`ALERTE`, décision
 * irréversible) ou en quarantaine (`BLOQUE`) qu'un contrôle qualité a condamné n'a aucun canal
 * de sortie normal (transformation, expédition, levée). Sans ce canal, sa quantité reste aux
 * livres indéfiniment, sans preuve de destruction opposable.
 */
export const SCRAPPABLE_BATCH_STATUSES: readonly BatchStatus[] = [
  BATCH_STATUSES.BLOCKED,
  BATCH_STATUSES.ALERT,
];

export type MovementType = (typeof MOVEMENT_TYPES)[keyof typeof MOVEMENT_TYPES];

/**
 * Contrôles qualité à la réception qui placent immédiatement le lot en quarantaine.
 */
export const QUARANTINE_RECEIPT_CONTROLS: readonly string[] = [
  RECEIPT_STATUSES.NON_CONFORM,
  RECEIPT_STATUSES.ALERT,
];
