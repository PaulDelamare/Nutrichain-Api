import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';

/**
 * Schéma de validation d'une expédition (POST /logistics/shipments).
 * Source du type `ShipmentPayload` consommé par le contrôleur via `req.validatedShipment`.
 */
export const shipmentSchema = vine.object({
  id_client: vine.string().uuid(),
  shipment_id: vine.string().minLength(3).maxLength(100),
  transporteur: vine.string().minLength(2).maxLength(100),
  destination_adresse: vine.string().minLength(5),
  created_by: vine.string().uuid().optional(),
  lots: vine
    .array(
      vine.object({
        id_lot: vine.string().uuid(),
        quantite_expediee: vine.number().positive(),
      })
    )
    .minLength(1),
});

export type ShipmentPayload = Infer<typeof shipmentSchema>;
