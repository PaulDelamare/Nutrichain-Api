import vine from '@vinejs/vine';

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
};

export const receiptPayloadSchema = vine.object(receiptPayloadFields);
