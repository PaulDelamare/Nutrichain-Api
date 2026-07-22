/**
 * Vocabulaire de rôles CANONIQUE et UNIQUE de NutriChain.
 *
 * Un membre a exactement un rôle (Better-Auth `Member.role`, mono-valué). Toute
 * autorisation en découle via les ensembles ci-dessous — c'est la SEULE source de
 * vérité des droits, appliquée à toutes les gardes de routes.
 *
 * (Remplace les anciens vocabulaires qui se télescopaient : `member`, `manager`,
 * et les `logistics_*` / `quality_control`.)
 */
export const ROLES = {
  /** Créateur de l'organisation — tous les droits, y compris la gestion de l'org. */
  OWNER: 'owner',
  /** Tous les droits métier + gestion de l'org (inviter, configurer). */
  ADMIN: 'admin',
  /** Décisions qualité / sécurité : levée de quarantaine, rappel, contrôles qualité. */
  QUALITY: 'quality',
  /** Opérations terrain : réception, transformation, expédition. */
  OPERATOR: 'operator',
  /** Lecture seule. */
  VIEWER: 'viewer',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

/** Lectures — tous les rôles. */
export const ALL_ROLES: Role[] = [
  ROLES.OWNER,
  ROLES.ADMIN,
  ROLES.QUALITY,
  ROLES.OPERATOR,
  ROLES.VIEWER,
];

/** Écritures métier (réception, transformation, expédition, scans terrain). */
export const WRITE_ROLES: Role[] = [ROLES.OWNER, ROLES.ADMIN, ROLES.OPERATOR];

/**
 * Décisions qualité / sécurité (levée de quarantaine, rappel, résolution d'alerte,
 * contrôles qualité). L'opérateur en est exclu.
 *
 * ⚠️ Ce découpage NE SUFFIT PAS à assurer la séparation des tâches HACCP : `owner` et `admin`
 * figurent ici ET dans `WRITE_ROLES`, donc ils enregistrent un lot et peuvent en signer la
 * libération. La règle qui l'interdit porte sur la personne et vit dans
 * `logistics/shared/utils/separationOfDuties.ts`.
 */
export const QUALITY_ROLES: Role[] = [ROLES.OWNER, ROLES.ADMIN, ROLES.QUALITY];

/** Gestion de l'organisation (inviter, configurer, vérifier l'audit). */
export const ADMIN_ROLES: Role[] = [ROLES.OWNER, ROLES.ADMIN];

/**
 * Lecture de DONNÉES PERSONNELLES : annuaire nominatif du personnel, journal d'audit « qui a fait
 * quoi », coordonnées des clients et fournisseurs. Réservé à l'administration.
 *
 * Ces lectures étaient ouvertes à `ALL_ROLES` (donc au `viewer`, lecture seule) : le rôle le plus
 * faible voyait l'e-mail et le statut MFA de chaque salarié, et le journal de leurs actions. C'est
 * une violation du moindre privilège et un enjeu RGPD — le DPIA n'aurait pas pu le justifier.
 * Les lectures purement MÉTIER (catalogue, lots, événements, alertes) restent en `ALL_ROLES`.
 */
export const PERSONAL_DATA_ROLES: Role[] = [ROLES.OWNER, ROLES.ADMIN];

/**
 * Rôles proposés à l'invitation. `owner` en est absent : il n'y a qu'un propriétaire,
 * le créateur de l'organisation — on n'invite pas un second owner.
 */
export const INVITABLE_ROLES = [ROLES.ADMIN, ROLES.QUALITY, ROLES.OPERATOR, ROLES.VIEWER] as const;

/**
 * @deprecated Conservé pour la validation d'invitation ; alias de `INVITABLE_ROLES`.
 */
export const USER_ROLES = INVITABLE_ROLES;

/**
 * Configuration des expirations.
 */
export const INVITATION_EXPIRATION_DAYS = 7;
