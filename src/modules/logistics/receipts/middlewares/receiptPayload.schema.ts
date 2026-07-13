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
 * Schéma complet du flow direct POST /logistics/receipts.
 *
 * `received_by` a disparu du payload : l'auteur d'une réception est scellé dans l'audit WORM, il
 * ne peut pas être choisi par le client. En session, il vient de la session ; en M2M (clé API),
 * `actorUserId` est déclaré PUIS vérifié membre de l'organisation (cf. resolveWritingActor).
 *
 * L'identifiant est une chaîne opaque, sans contrainte de format : l'ancienne règle `uuid()`
 * rejetait les comptes créés avant l'alignement de Better-Auth sur les UUID — dont le compte de
 * démonstration. La sécurité vient de la vérification d'appartenance, pas de la forme de l'id.
 */
export const receiptValidationSchema = vine.object({
  ...receiptPayloadFields,
  actorUserId: vine.string().minLength(1).optional(),
});

export type ReceiptPayload = Infer<typeof receiptValidationSchema>;
