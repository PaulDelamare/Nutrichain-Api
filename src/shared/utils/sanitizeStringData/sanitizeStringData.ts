import sanitizeHtml from 'sanitize-html';

/**
 * Fonction générique pour assainir les données.
 * Elle applique une sanitisation HTML sur tous les champs de type string dans l'objet `data`.
 *
 * @param data - Un objet dont les clés sont des chaînes de caractères et les valeurs peuvent être de tout type.
 * @param allowedTags - Un tableau de balises HTML autorisées.
 * @param allowedAttributes - Un objet des balises HTML avec leurs attributs autorisés.
 * @returns Un objet avec les données assainies.
 */
export function sanitizeDataWithHtml<T extends Record<string, unknown>>(
  data: T,
  allowedTags: string[] = [],
  allowedAttributes: Record<string, string[]> = {}
): T {
  const sanitizedData: T = { ...data };

  for (const key in sanitizedData) {
    if (typeof sanitizedData[key] === 'string') {
      sanitizedData[key] = sanitizeHtml(sanitizedData[key] as string, {
        allowedTags: allowedTags,
        allowedAttributes: allowedAttributes,
      }) as T[Extract<keyof T, string>];
    }
  }

  return sanitizedData;
}
