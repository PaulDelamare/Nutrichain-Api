import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/build/src/types';

/**
 * Le SSCC vient d'une caméra : on le borne avant qu'il n'atteigne la base.
 *
 * 18 chiffres, ou 20 quand la lecture a conservé le préfixe d'AI `00` — les deux formes arrivent
 * réellement selon le lecteur. Toute autre longueur n'est pas un SSCC : un code produit lu par
 * mégarde doit être refusé ici, pas interrogé en base.
 */
export const palletScanSchema = vine.object({
  sscc: vine
    .string()
    .trim()
    .regex(/^(00)?\d{18}$/),
});

export type PalletScanParams = Infer<typeof palletScanSchema>;
