/**
 * Plafonds de volumétrie des lectures paginées.
 *
 * Une valeur unique, parce qu'un plafond recopié à cinq endroits n'est pas un plafond : c'est cinq
 * occasions d'en oublier un. Deux routes en étaient d'ailleurs dépourvues — `?limit=100000000`
 * chargeait toutes les réceptions avec leur jointure fournisseur, et `?limit=abc` produisait un
 * `take: NaN` qui sortait en 500 au lieu d'un 400.
 */
export const MAX_PAGE_SIZE = 500;
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Plafond du NUMÉRO de page. Borner `limit` ne suffit pas : `skip = (page - 1) * limit`, donc un
 * `?page=1e19` produisait un `skip` de 2e21 que Prisma refuse — le même 500 que `?page=0`, de
 * l'autre côté de l'axe. À 500 par page, 100 000 pages couvrent 50 millions de lignes.
 */
export const MAX_PAGE_NUMBER = 100_000;

/**
 * Longueur maximale d'un terme de recherche libre. Au-delà, ce n'est plus une recherche : c'est un
 * `LIKE` sur une chaîne arbitraire envoyée à la base.
 */
export const MAX_SEARCH_LENGTH = 100;
