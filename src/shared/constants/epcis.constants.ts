/**
 * Vocabulaire EPCIS / CBV (Core Business Vocabulary GS1) centralisé.
 * Source unique pour l'émission des events (réception, expédition) et leur
 * restitution/filtrage, afin d'éviter la dérive des magic strings.
 *
 * Dette connue (conformité GS1 partielle) : les `epcList` des events portent
 * aujourd'hui l'UUID interne du lot (`batch.id`), pas une URN SGTIN
 * (`urn:epc:id:sgtin:<gtin>.<serial>`). Conforme aux specs projet (traçabilité
 * « maison »), pas au standard EPCIS strict. Évolution dédiée prévue :
 * construction d'URN depuis `code_gtin` (désormais obligatoire) + sérialisation
 * JSON-LD + AggregationEvent palettes.
 */

export const EPCIS_EVENT_TYPE = { object: 'ObjectEvent' } as const;
export const EPCIS_RELATED_ENTITY = { receipt: 'Receipt', shipment: 'Shipment' } as const;

// Tuples dérivés pour les enums VineJS (filtrage des query params).
export const EPCIS_EVENT_TYPES = [EPCIS_EVENT_TYPE.object] as const;
export const EPCIS_RELATED_ENTITIES = [
  EPCIS_RELATED_ENTITY.receipt,
  EPCIS_RELATED_ENTITY.shipment,
] as const;

export type EpcisEventType = (typeof EPCIS_EVENT_TYPES)[number];
export type EpcisRelatedEntity = (typeof EPCIS_RELATED_ENTITIES)[number];

export const EPCIS_BIZSTEP = {
  receiving: 'urn:epcglobal:cbv:bizstep:receiving',
  shipping: 'urn:epcglobal:cbv:bizstep:shipping',
} as const;

export const EPCIS_DISPOSITION = {
  active: 'urn:epcglobal:cbv:disp:active',
  inTransit: 'urn:epcglobal:cbv:disp:in_transit',
} as const;

export const EPCIS_ACTION = {
  add: 'ADD',
  observe: 'OBSERVE',
} as const;
