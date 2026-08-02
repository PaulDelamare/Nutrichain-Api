/**
 * Message générique du middleware verifyAlertAccess.
 *
 * Doit être strictement IDENTIQUE pour les trois cas d'échec d'accès
 * (alerte inexistante, alerte d'une autre org, id malformé) pour ne pas
 * révéler par message ou timing si un id donné correspond à une vraie alerte
 * d'une autre tenant — anti-enumeration.
 */
export const ALERT_NOT_FOUND_MSG = 'Alerte introuvable ou accès refusé.';

/**
 * Le seul type d'alerte qui ISOLE des lots (statut `BLOQUE` + mouvement `QUARANTAINE_FROID`).
 *
 * Un `PRODUCT_RECALL` bloque lui aussi de la marchandise, mais en `ALERTE` (irréversible) et via des
 * mouvements `RAPPEL` : ses lots ne se consultent pas par le même canal.
 */
export const COLD_CHAIN_ALERT_TYPE = 'TEMP_EXCURSION';

/**
 * Types d'alerte qui matérialisent un RAPPEL produit, tels qu'écrits par `recall.service.ts` :
 * `PRODUCT_RECALL` (déclenchement) et `RECALL_DEPTH_SATURATION` (descendance possiblement
 * incomplète). `RAPPEL` est conservé pour d'anciennes lignes. C'est l'ensemble que la façade de
 * lecture des rappels filtre côté base — la page ne parcourt plus toutes les alertes pour en
 * extraire les rappels côté front.
 */
export const RECALL_ALERT_TYPES = ['PRODUCT_RECALL', 'RAPPEL', 'RECALL_DEPTH_SATURATION'] as const;
