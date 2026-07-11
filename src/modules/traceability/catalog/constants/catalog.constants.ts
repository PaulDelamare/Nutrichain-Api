import { LOGISTICS_ROLES } from '../../../logistics/constants/logistics.constants';

/**
 * Qui peut LIRE le catalogue (produits, lots).
 *
 * Les rôles logistiques en font partie : l'opérateur terrain doit choisir un produit pour
 * saisir une réception (mobile, `POST /api/sync/scans` l'autorise déjà). Les restreindre aux
 * rôles d'organisation lui renvoyait un 403 et rendait la réception impossible — le compte
 * de démo, `owner`, masquait le problème.
 */
export const CATALOG_READ_ROLES: string[] = [
  'owner',
  'admin',
  'member',
  ...Object.values(LOGISTICS_ROLES),
];
