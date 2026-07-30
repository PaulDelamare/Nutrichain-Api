import vine from '@vinejs/vine';
import { SSCC_PATTERN } from '../../../../shared/utils/gs1/sscc';
import type { Infer } from '@vinejs/vine/build/src/types';

/**
 * Schéma de validation d'une expédition (POST /logistics/shipments).
 * Source du type `ShipmentPayload` consommé par le contrôleur via `req.validatedShipment`.
 */
export const shipmentSchema = vine.object({
  id_client: vine.string().uuid(),
  shipment_id: vine.string().minLength(3).maxLength(100),
  transporteur: vine.string().minLength(2).maxLength(100),
  destination_adresse: vine.string().minLength(5).maxLength(255),
  // `created_by` retiré : l'auteur d'une expédition vient de la session, jamais du client.
  //
  // Expédier une PALETTE : on scanne son SSCC, et son contenu devient les lignes du bon. C'est le
  // geste du quai — on charge un contenant, pas une liste de lots. Le code lu peut porter son AI
  // `00` : l'étiquette encode l'element string complet.
  //
  // 50 palettes : un semi-remorque en porte 33. Chacune développant jusqu'à 100 lots, la borne de
  // `lots` reste le vrai garde-fou de la taille de transaction.
  palettes: vine.array(vine.string().trim().regex(SSCC_PATTERN)).maxLength(50).optional(),
  // Facultatif depuis qu'on peut expédier des palettes — mais l'un des deux doit porter quelque
  // chose, et c'est le service qui le tranche : VineJS ne sait pas exprimer « au moins l'un ».
  lots: vine
    .array(
      vine.object({
        id_lot: vine.string().uuid(),
        quantite_expediee: vine.number().positive(),
      })
    )
    // Une expédition à 50 000 lignes tenait dans le corps accepté par Express et ouvrait une
    // transaction géante. 500 lots sur un même bon de livraison est déjà très au-delà d'un camion.
    .maxLength(500)
    .optional(),
});

export type ShipmentPayload = Infer<typeof shipmentSchema>;
