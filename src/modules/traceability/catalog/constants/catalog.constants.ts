import { ALL_ROLES } from '../../../identity/constants/roles.constants';

/**
 * Qui peut LIRE le catalogue (produits, lots) : tous les rôles.
 * L'opérateur terrain doit pouvoir choisir un produit pour saisir une réception.
 */
export const CATALOG_READ_ROLES: string[] = [...ALL_ROLES];
