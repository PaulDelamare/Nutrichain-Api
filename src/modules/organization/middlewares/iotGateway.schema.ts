import vine from '@vinejs/vine';
import { makeBodyValidator } from './referenceData.schema';

// Seul le nom est fourni : la clé est générée par le serveur. La laisser choisir au client
// permettrait de poser un secret faible, ou déjà connu d'un tiers.
const createIotGatewaySchema = vine.object({
  nom: vine.string().trim().minLength(2).maxLength(120),
});

export const validateCreateIotGateway = makeBodyValidator(createIotGatewaySchema);
