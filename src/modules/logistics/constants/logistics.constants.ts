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

// ========== STATUTS DE LIVRAISON ==========
/**
 * États d'une expédition, source unique de vérité pour `Shipment.statut_livraison`.
 *
 * Deux valeurs seulement, parce qu'aucun geste n'en atteint d'autres. `bdd.md` et `context.md` en
 * documentaient quatre : `PREPARATION` n'existe pas — une expédition naît au départ — et `RETOURNE`
 * n'a aucun geste. Déclarer un état que rien n'atteint est le défaut d'`Equipment.statut`, jamais
 * écrit. Le retour se déclarera avec le geste qui le produit, et avec le correctif du portail
 * magasins, qui compte aujourd'hui « en cours » tout ce qui n'est pas `LIVRE`.
 *
 * ⚠️ Cette constante ne protège que `src/` : `prisma/` et `scripts/` sont hors du périmètre de
 * `tsconfig.check.json`, et c'est ainsi qu'un `EN_TRANSIT` s'est glissé dans le seed sans que rien
 * ne le voie. La garde qui mord vraiment est la contrainte CHECK en base.
 */
export const SHIPMENT_DELIVERY_STATUSES = {
  /** Partie du quai, arrivée non constatée. */
  IN_TRANSIT: 'EN_ROUTE',
  /** Arrivée constatée, datée et attribuée. */
  DELIVERED: 'LIVRE',
} as const;

export type ShipmentDeliveryStatus =
  (typeof SHIPMENT_DELIVERY_STATUSES)[keyof typeof SHIPMENT_DELIVERY_STATUSES];

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
  /**
   * Arrivée constatée chez le client. Aucune matière ne bouge de notre côté — comme `RAPPEL` ou
   * `LEVEE_QUARANTAINE`, qui s'écrivent aussi sur des lots qui ne sont plus manipulables ici. Sans
   * ce maillon, la frise d'un lot s'arrêterait à `EXPEDITION` et le décideur qui l'ouvre pendant un
   * rappel ne saurait pas si la marchandise est arrivée.
   */
  DELIVERY: 'LIVRAISON',
  /**
   * Retrait du rayon d'un magasin. Distinct de la mise au rebut : ce sont deux gestes, et le
   * client qui retire n'est pas nous. Rien ne bouge dans notre stock — la marchandise en a ete
   * deduite a l'expedition — mais la boucle du rappel ne se ferme pas sans lui.
   */
  SHELF_WITHDRAWAL: 'RETRAIT_MAGASIN',
} as const;

/**
 * Statuts d'un lot qu'on peut RANGER ailleurs — la destination reste bornée aux emplacements de
 * stockage (`STORAGE_EQUIPMENT_TYPES`), jamais une cuve : déplacer n'est pas engager en production.
 *
 * `BLOQUE` en fait partie, et c'est le cas qui compte : quand un groupe froid tombe en panne, la
 * marchandise mise en quarantaine par l'incident est précisément celle qu'il faut évacuer. La
 * refuser immobilisait le stock dans l'équipement défaillant, au moment exact où il fallait le
 * vider. Le déplacement ne touche QUE la position : ni `statut`, ni `statut_avant_blocage`.
 *
 * `ALERTE` (rappel produit) reste immobilisé : la décision est irréversible et sa seule issue est
 * le rebut ; on ne fait pas circuler de la marchandise rappelée.
 *
 * ⚠️ Limite connue, antérieure et indépendante du déplacement : un lot déjà `BLOQUE` n'est pas
 * re-marqué par une SECONDE excursion, où qu'il soit — `COLD_QUARANTINABLE_STATUSES` ne le contient
 * pas, et le `UPDATE` de `iotAlert.service` y écrit `statut_avant_blocage = statut`, ce qui
 * écraserait la valeur de restauration. Le second incident reste donc sans trace sur ce lot.
 */
export const MOVABLE_BATCH_STATUSES: readonly BatchStatus[] = [
  BATCH_STATUSES.IN_STOCK,
  BATCH_STATUSES.PENDING_QC,
  BATCH_STATUSES.BLOCKED,
];

/**
 * Statuts d'un lot qu'on peut poser sur une palette.
 *
 * `EN_ATTENTE_QC` en fait partie, et ce n'est pas un oubli : une palette se monte en fin de ligne,
 * avant le contrôle de sortie d'usine. L'interdire obligerait à palettiser après coup, c'est-à-dire
 * jamais.
 *
 * `BLOQUE` en est exclu, contrairement au déplacement : évacuer un lot consigné d'un frigo en panne
 * est légitime, l'agréger à une palette de marchandise saine ne l'est pas — la palette voyage comme
 * un tout, et rien ne distinguerait plus le lot consigné des autres au moment de l'expédition.
 */
export const PALLETIZABLE_BATCH_STATUSES: readonly BatchStatus[] = [
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
