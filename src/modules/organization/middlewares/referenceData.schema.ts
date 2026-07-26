import vine from '@vinejs/vine';
import { Response, NextFunction } from 'express';
import { validateData } from '../../../shared/utils/validateData/validateData';
import { catchAsync } from '../../../shared/utils/errorHandler/catchAsync';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { APIError } from '../../../shared/utils/errorHandler/APIError';

// Fournisseur
const createSupplierSchema = vine.object({
  nom_ferme: vine.string().trim().minLength(2).maxLength(120),
  adresse_siege: vine.string().trim().minLength(2).maxLength(200),
  type_produit: vine.string().trim().maxLength(120).optional(),
  contact_qualite: vine.string().trim().maxLength(120).optional(),
});

const updateSupplierSchema = vine.object({
  nom_ferme: vine.string().trim().minLength(2).maxLength(120).optional(),
  adresse_siege: vine.string().trim().minLength(2).maxLength(200).optional(),
  type_produit: vine.string().trim().maxLength(120).nullable().optional(),
  contact_qualite: vine.string().trim().maxLength(120).nullable().optional(),
});

// Emplacement. `type` est une chaîne libre : le jeu de démonstration utilise RECEPTION /
// COLD_STORAGE / PRODUCTION, un enum fermé invaliderait ces valeurs à l'édition.
//
// Coordonnées : bornées au domaine géographique réel. Hors bornes, ce n'est pas un point sur Terre
// mais une saisie inversée (lat/lng permutées) ou une unité étrangère — le refuser vaut mieux que
// poser un repère absurde sur la fiche lot.
// `requiredIfExists` croise les deux champs : une latitude seule ne place aucun point sur une carte,
// donc on n'accepte jamais la moitié d'une position.
const latitudeRule = () => vine.number().min(-90).max(90);
const longitudeRule = () => vine.number().min(-180).max(180);

const createLocationSchema = vine.object({
  nom: vine.string().trim().minLength(2).maxLength(120),
  type: vine.string().trim().minLength(2).maxLength(60),
  description: vine.string().trim().maxLength(300).optional(),
  latitude: latitudeRule().optional().requiredIfExists('longitude'),
  longitude: longitudeRule().optional().requiredIfExists('latitude'),
});

const updateLocationSchema = vine.object({
  nom: vine.string().trim().minLength(2).maxLength(120).optional(),
  type: vine.string().trim().minLength(2).maxLength(60).optional(),
  description: vine.string().trim().maxLength(300).nullable().optional(),
  // `null` sur les DEUX efface la position (le lieu redevient sans carte). La cohérence du couple
  // face à l'état déjà en base est vérifiée par le service, qui seul connaît cet état.
  latitude: latitudeRule().nullable().optional().requiredIfExists('longitude'),
  longitude: longitudeRule().nullable().optional().requiredIfExists('latitude'),
});

// L'archivage/réactivation porte l'état cible. VineJS coerce 'true'/'false'/1/0 en booléen.
const setActiveSchema = vine.object({ active: vine.boolean() });

export const makeBodyValidator = <T>(schema: T, { rejectEmpty = false } = {}) =>
  catchAsync(async (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    const validated = await validateData(schema as never, req.body);

    // Un PATCH sans aucun champ n'a rien à modifier : le refuser évite une ligne d'audit fantôme
    // (oldValue === newValue) dans une chaîne WORM censée n'enregistrer que de vrais changements.
    if (rejectEmpty && Object.keys(validated as object).length === 0) {
      throw new APIError(400, {
        error: [{ field: 'body', message: 'Aucune modification fournie.' }],
      });
    }

    req.body = validated;
    next();
  });

export const validateCreateSupplier = makeBodyValidator(createSupplierSchema);
export const validateUpdateSupplier = makeBodyValidator(updateSupplierSchema, {
  rejectEmpty: true,
});
export const validateCreateLocation = makeBodyValidator(createLocationSchema);
export const validateUpdateLocation = makeBodyValidator(updateLocationSchema, {
  rejectEmpty: true,
});
export const validateSetActive = makeBodyValidator(setActiveSchema);
