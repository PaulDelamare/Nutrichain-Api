import vine from '@vinejs/vine';

/**
 * Règle de validation personnalisée pour les mots de passe.
 * Le mot de passe doit contenir :
 * - Au moins 12 caractères
 * - Au moins 1 majuscule
 * - Au moins 1 chiffre
 * - Au moins 1 caractère spécial
 */
export const passwordRule = vine.createRule((value, options, field) => {
  if (typeof value !== 'string') {
    return;
  }

  const isValid = /^(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z\d]).{12,}$/.test(value);

  if (!isValid) {
    field.report(
      'Le mot de passe doit contenir au moins 12 caractères, une majuscule, un chiffre et un caractère spécial.',
      'password',
      field
    );
  }
});
