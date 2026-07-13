import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';

/**
 * Champs du payload d'une opération de réception, partagés entre :
 * - `validateReceipt.middleware.ts` (flow direct POST /logistics/receipts)
 * - `validateSyncScans.middleware.ts` (bulk sync mobile, sous `items[*].payload`)
 *
 * Toute évolution (nouvelle valeur d'enum, contrainte de longueur…) se fait ICI
 * et propage aux deux validators sans drift.
 */
export const receiptPayloadFields = {
  id_fournisseur: vine.string().uuid(),
  shipment_id: vine.string().minLength(3).maxLength(100),
  id_produit: vine.string().uuid(),
  quantite_actuelle: vine.number().positive(),
  unite_code: vine.string().maxLength(10),
  statut_controle: vine.enum(['OK', 'ALERTE', 'NONCONFORME', 'CONFORME']),
  // Emplacement de stockage du lot reçu (matériel) — optionnel.
  id_materiel: vine.string().uuid().optional(),
};

export const receiptPayloadSchema = vine.object(receiptPayloadFields);

/**
 * Schéma de POST /logistics/receipts.
 *
 * Le payload n'a AUCUN champ pour désigner l'auteur — ni `received_by`, ni `actorUserId`. Il vient
 * de la session, et l'écriture est refusée sans elle. Laisser le champ « au cas où » serait une
 * arme chargée : la première route remontée derrière une clé rouvrirait l'usurpation, sans qu'un
 * test ne bronche. Ce qui n'existe pas ne se falsifie pas.
 */
export const receiptValidationSchema = vine.object({
  ...receiptPayloadFields,
});

export type ReceiptPayload = Infer<typeof receiptValidationSchema>;
