/**
 * Les rôles autorisés dans l'application NutriChain.
 * Définit la hiérarchie et les accès à travers les Zones/Organisations.
 */
export const USER_ROLES = ["owner", "admin", "manager", "operator"] as const;

/**
 * Type dérivé du tableau des rôles constants.
 */
export type UserRole = typeof USER_ROLES[number];

/**
 * Configuration des expirations.
 */
export const INVITATION_EXPIRATION_DAYS = 7;
