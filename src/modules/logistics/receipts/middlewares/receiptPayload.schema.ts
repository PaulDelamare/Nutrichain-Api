import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';
import { RECEIPT_STATUSES } from '../../constants/logistics.constants';

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
  // Dérivé de RECEIPT_STATUSES (source unique) : recopier la liste à la main avait introduit un
  // « CONFORME » fantôme, accepté mais qui ne déclenchait rien — le lot partait en stock comme un OK.
  statut_controle: vine.enum(Object.values(RECEIPT_STATUSES)),
  // Emplacement de stockage du lot reçu (matériel) — optionnel.
  id_materiel: vine.string().uuid().optional(),
  // Numéro de lot du fournisseur (GS1 AI 10, ≤ 20 caractères). Absent, le serveur en génère un.
  // Le jeu GS1 (CSET82) autorise `/` et `#`, mais le numéro est interpolé SANS échappement dans le
  // QR Digital Link (`/gs1/01/{gtin}/10/{lot}`) et dans l'URN EPCIS : un `/` ajouterait un segment
  // d'URL, un `#` tronquerait tout le reste — étiquette morte, événement EPCIS invalide. On s'en
  // tient donc à ce qui traverse une URL et une URN sans dommage.
  lot_number: vine
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{1,20}$/)
    .optional(),
  // DLC du fournisseur (GS1 AI 17). Un JOUR, pas un instant — le service l'ancre en fin de journée
  // UTC (le 20/07 est consommable jusqu'au 20/07 au soir) et refuse un jour inexistant.
  date_peremption: vine
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
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
