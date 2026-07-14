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
