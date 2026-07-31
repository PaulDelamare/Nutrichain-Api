import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';
import { SSCC_PATTERN } from '../../../../shared/utils/gs1/sscc';

/**
 * Nombre maximal de lots sur une palette.
 *
 * Une palette EUR porte au grand maximum quelques dizaines de références distinctes ; 100 laisse
 * une marge confortable tout en fermant la porte à une liste sans plafond, qui ferait de la
 * constitution une transaction arbitrairement longue — donc un verrou arbitrairement long sur la
 * chaîne d'audit de l'organisation.
 */
export const MAX_LOTS_PER_LOGISTIC_UNIT = 100;

export const createLogisticUnitSchema = vine.object({
  items: vine
    .array(
      vine.object({
        id_lot: vine.string().trim().uuid(),
        // Positive : une ligne à zéro n'est pas une erreur de saisie anodine, c'est une palette qui
        // déclare porter un lot sans en porter la moindre quantité.
        quantite: vine.number().positive(),
      })
    )
    .minLength(1)
    .maxLength(MAX_LOTS_PER_LOGISTIC_UNIT),
});

/**
 * Le SSCC vient d'une caméra : on le borne avant qu'il n'atteigne la base.
 *
 * 18 chiffres, ou 20 quand la lecture a conservé le préfixe d'AI `00` — les deux formes arrivent
 * réellement selon le lecteur. Toute autre longueur n'est pas un SSCC : un code produit lu par
 * mégarde se refuse ici, il ne s'interroge pas en base.
 */
export const scanLogisticUnitSchema = vine.object({
  sscc: vine
    .string()
    .trim()
    .regex(SSCC_PATTERN),
});

/** Rangement d'une palette : seul l'emplacement de destination est fourni. */
export const moveLogisticUnitSchema = vine.object({
  id_materiel: vine.string().trim().uuid(),
});

/**
 * Ouverture d'une palette : rien d'autre que son identifiant, borné.
 *
 * `Logistic_Unit.id` est une colonne texte : un identifiant malformé n'y provoque aucune erreur de
 * type, il rend simplement 404. Le valider ici distingue « ce n'est pas un identifiant » de « cette
 * palette n'existe pas », et referme la requête avant qu'elle n'atteigne la base.
 */
export const openLogisticUnitSchema = vine.object({
  id: vine.string().trim().uuid(),
});

export type CreateLogisticUnitPayload = Infer<typeof createLogisticUnitSchema>;
export type ScanLogisticUnitParams = Infer<typeof scanLogisticUnitSchema>;
export type MoveLogisticUnitPayload = Infer<typeof moveLogisticUnitSchema>;
export type OpenLogisticUnitParams = Infer<typeof openLogisticUnitSchema>;
