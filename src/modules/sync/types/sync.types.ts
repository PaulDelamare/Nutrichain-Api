/**
 * Types du module Sync — endpoint bulk pour la synchronisation des opérations
 * effectuées en mode offline par l'application mobile (Objectif SMART n°4).
 *
 * Voir docs/14_sync_mobile_offline.md pour le contrat complet.
 */

/**
 * Payload d'une opération de type "receipt" (réception logistique).
 *
 * DÉDUIT du schéma VineJS, jamais recopié. Cette interface était maintenue à la main en parallèle
 * et avait déjà dérivé : le middleware validait des champs que le type ignorait, donc le service ne
 * pouvait pas les lire — un ajout au schéma se perdait en silence entre la validation et le métier.
 * (`received_by` n'y figure pas : l'auteur est forcé serveur-side, cf. resolveWritingActor.)
 */
import type { ReceiptPayload } from '../../logistics/receipts/middlewares/receiptPayload.schema';

export type { ReceiptPayload };

/**
 * Types d'opérations supportées en v1. Extensible sans breaking change
 * (ajouter 'transformation', 'shipment', etc. dans une PR ultérieure).
 */
export type SyncItemType = 'receipt';

/**
 * Un item du bulk sync. Le clientOpId est généré par le mobile au moment du
 * scan offline et reste identique en cas de retry.
 */
export interface SyncItem {
  clientOpId: string;
  type: SyncItemType;
  payload: ReceiptPayload;
}

/**
 * Payload validé attaché à req.validatedSyncScans par le middleware.
 * `actorUserId` : utilisé uniquement en mode M2M (clé API) pour identifier l'opérateur
 * du terminal scanner. Ignoré en mode session (l'utilisateur est forcé à req.auth.user.id).
 */
export interface SyncScansPayload {
  items: SyncItem[];
  actorUserId?: string;
}

/**
 * Statut résultant d'une opération individuelle.
 * - 'ok'       : opération créée avec succès (ou rejouée à l'identique)
 * - 'error'    : échec métier (FK manquante, validation, etc.)
 * - 'conflict' : même clientOpId rejoué avec un payload divergent
 */
export type SyncItemStatus = 'ok' | 'error' | 'conflict';

/**
 * Identifiants serveur retournés lors d'une création de réception.
 */
export interface ReceiptServerId {
  receiptId: string;
  batchId: string;
}

/**
 * Détail d'erreur retourné par item (structure alignée sur APIError.body.error[]).
 */
export interface SyncItemError {
  field: string;
  message: string;
}

/**
 * Résultat d'un item dans la réponse 207 Multi-Status.
 */
export interface SyncItemResult {
  clientOpId: string;
  status: SyncItemStatus;
  serverId?: ReceiptServerId;
  error?: SyncItemError;
}

/**
 * Résumé agrégé renvoyé en plus des résultats détaillés.
 */
export interface SyncSummary {
  total: number;
  ok: number;
  error: number;
  conflict: number;
}

/**
 * Body de la réponse 207 (champ `data` de sendSuccess).
 */
export interface SyncScansResponse {
  results: SyncItemResult[];
  summary: SyncSummary;
}
