/**
 * Constantes métier du domaine Logistics
 * 
 * RESPONSABILITÉ:
 * - Centraliser les énumérations de rôles, permissions et matrices de contrôle
 * - Servir de source unique de vérité (Single Source of Truth)
 * - Éviter les typos et strings magiques dans le code
 */

// ========== RÔLES MÉTIER LOGISTICS ==========
/**
 * Énumération des rôles spécifiques au domaine Logistics.
 * 
 * Ces rôles seront stockés dans Member.role (string) et matchés lors de la vérification.
 * Chaque rôle représente un ensemble de permissions (voir ROUTE_ROLE_MATRIX).
 */
export const LOGISTICS_ROLES = {
  /** Administrateur: Toutes les opérations + statistiques */
  ADMIN: 'logistics_admin',

  /** Opérateur: Créer des réceptions, consulter ses propres données, lister */
  OPERATOR: 'logistics_operator',

  /** Lecteur: Consultation uniquement (read-only) */
  VIEWER: 'logistics_viewer',

  /** Qualité: Lecture + gestion des tests de qualité */
  QA: 'quality_control',
} as const;

export type LogisticsRole = (typeof LOGISTICS_ROLES)[keyof typeof LOGISTICS_ROLES];

// ========== PERMISSIONS ATOMIQUES (ABAC Future) ==========
/**
 * Permissions granulaires pour un système ABAC futur.
 * 
 * Actuellement inutilisées (nous utilisons RBAC).
 * À utiliser pour une migration vers une sécurité plus fine.
 */
export const LOGISTICS_PERMISSIONS = {
  CREATE: 'logistics:create',
  READ: 'logistics:read',
  READ_STATS: 'logistics:read_stats',
  UPDATE: 'logistics:update',
  DELETE: 'logistics:delete',
} as const;

// ========== MATRICE RÔLES ↔ ROUTES ==========
/**
 * Définit les rôles autorisés pour chaque route.
 * 
 * Utilisation:
 * ```typescript
 * const requiredRoles = ROUTE_ROLE_MATRIX['POST:/receipts'];
 * // => ['logistics_admin', 'logistics_operator']
 * ```
 */
export const ROUTE_ROLE_MATRIX = {
  // POST /api/logistics/receipts : Créer une réception
  'POST:/receipts': [LOGISTICS_ROLES.ADMIN, LOGISTICS_ROLES.OPERATOR],

  // GET /api/logistics/receipts : Lister les réceptions
  'GET:/receipts': [
    LOGISTICS_ROLES.ADMIN,
    LOGISTICS_ROLES.OPERATOR,
    LOGISTICS_ROLES.VIEWER,
    LOGISTICS_ROLES.QA,
  ],

  // GET /api/logistics/receipts/:id : Consulter une réception
  'GET:/receipts/:id': [
    LOGISTICS_ROLES.ADMIN,
    LOGISTICS_ROLES.OPERATOR,
    LOGISTICS_ROLES.VIEWER,
    LOGISTICS_ROLES.QA,
  ],

  // GET /api/logistics/receipts/stats : Statistiques (ADMIN UNIQUEMENT)
  'GET:/receipts/stats': [LOGISTICS_ROLES.ADMIN],

  // GET /api/logistics/batches/:id : Consulter un lot
  'GET:/batches/:id': [
    LOGISTICS_ROLES.ADMIN,
    LOGISTICS_ROLES.OPERATOR,
    LOGISTICS_ROLES.VIEWER,
    LOGISTICS_ROLES.QA,
  ],
} as const;

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
 * Énumération des statuts possibles pour un lot.
 */
export const BATCH_STATUSES = {
  IN_STOCK: 'EN_STOCK',
  IN_PRODUCTION: 'EN_PRODUCTION',
  EXPIRED: 'EXPIRED',
  QUARANTINED: 'QUARANTINED',
} as const;
