/**
 * Vocabulaire EPCIS / CBV (Core Business Vocabulary GS1) centralisé.
 * Source unique pour l'émission des events (réception, expédition) et leur
 * restitution/filtrage, afin d'éviter la dérive des magic strings.
 *
 * Identification GS1 stricte : les lots sont identifiés au niveau classe par
 * une URN LGTIN (`urn:epc:class:lgtin:<prefix>.<itemref>.<lot>`) portée dans
 * `quantityList` (un lot est une classe, pas une instance — le niveau instance
 * SGTIN supposerait une sérialisation unitaire, hors périmètre). À l'expédition,
 * un AggregationEvent relie le contenant SSCC (`urn:epc:id:sscc:...`) aux lots.
 */

export const EPCIS_EVENT_TYPE = {
  object: 'ObjectEvent',
  aggregation: 'AggregationEvent',
  transformation: 'TransformationEvent',
} as const;
export const EPCIS_RELATED_ENTITY = {
  receipt: 'Receipt',
  shipment: 'Shipment',
  transformation: 'Transformation',
  logisticUnit: 'Logistic_Unit',
} as const;

// Tuples dérivés pour les enums VineJS (filtrage des query params).
export const EPCIS_EVENT_TYPES = [
  EPCIS_EVENT_TYPE.object,
  EPCIS_EVENT_TYPE.aggregation,
  EPCIS_EVENT_TYPE.transformation,
] as const;
export const EPCIS_RELATED_ENTITIES = [
  EPCIS_RELATED_ENTITY.receipt,
  EPCIS_RELATED_ENTITY.shipment,
  EPCIS_RELATED_ENTITY.transformation,
  EPCIS_RELATED_ENTITY.logisticUnit,
] as const;

export const EPCIS_BIZSTEP = {
  receiving: 'urn:epcglobal:cbv:bizstep:receiving',
  shipping: 'urn:epcglobal:cbv:bizstep:shipping',
  transforming: 'urn:epcglobal:cbv:bizstep:transforming',
  // Constitution d'une palette : c'est là que le SSCC est attribué et l'agrégation déclarée, et
  // non au départ du camion — une palette existe et se stocke avant d'être expédiée.
  packing: 'urn:epcglobal:cbv:bizstep:packing',
  // Départ de la palette : ce qu'elle portait cesse d'être dans la palette pour passer dans
  // l'expédition. Sans ce pas, deux contenants revendiqueraient la même marchandise indéfiniment.
  unpacking: 'urn:epcglobal:cbv:bizstep:unpacking',
} as const;

export const EPCIS_DISPOSITION = {
  active: 'urn:epcglobal:cbv:disp:active',
  inTransit: 'urn:epcglobal:cbv:disp:in_transit',
  inProgress: 'urn:epcglobal:cbv:disp:in_progress',
} as const;

export const EPCIS_ACTION = {
  add: 'ADD',
  delete: 'DELETE',
  observe: 'OBSERVE',
} as const;
