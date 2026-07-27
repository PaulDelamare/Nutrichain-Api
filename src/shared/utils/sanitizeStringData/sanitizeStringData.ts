import sanitizeHtml from 'sanitize-html';

/**
 * Champs dont la valeur est un SECRET : ils traversent l'assainissement sans être touchés (#245).
 *
 * Un mot de passe n'a aucun point de sortie : il va du corps de la requête à la fonction de hachage,
 * puis en base sous forme de condensat. Il n'est jamais interpolé dans un gabarit, jamais renvoyé,
 * jamais rendu — donc aucun contexte où il pourrait s'exécuter. L'assainir ne protégeait rien.
 *
 * Il coûtait, en revanche : `sanitizeHtml` avec `allowedTags: []` SUPPRIME le contenu de ce qui
 * ressemble à une balise. `abc<def123456` était haché comme `abc` — trois caractères — sans un mot
 * à l'utilisateur, et `a&b` devenait `a&amp;b`. Le XSS se traite à la SORTIE, dans le contexte de
 * rendu ; à l'entrée on ne sait pas encore où la donnée sortira, donc on ne peut pas l'échapper
 * correctement — on ne fait que détruire de la donnée légitime.
 *
 * L'exemption est volontairement ÉTROITE, et volontairement limitée aux mots de passe :
 * - `code` n'y est PAS : c'est un champ métier de ce dépôt (code d'unité, `qr_code_id`) qui est
 *   affiché, donc qui doit rester assaini. Et un code TOTP ou de secours ne contient ni `<` ni `&` :
 *   l'assainissement est déjà sans effet dessus, l'exempter n'apporterait rien.
 * - `token` n'y est pas non plus, pour la même raison : c'est un UUID, il traverse déjà intact.
 *
 * Le motif couvre en revanche toute la famille (`password`, `newPassword`, `currentPassword`,
 * `confirmPassword`), et c'est le comportement PAR DÉFAUT de la fonction : un appelant ne peut pas
 * oublier de le demander.
 */
const CHAMP_SECRET = /password/i;

/**
 * Fonction générique pour assainir les données.
 * Elle applique une sanitisation HTML sur tous les champs de type string dans l'objet `data`,
 * à l'exception des champs de secret (voir `CHAMP_SECRET`).
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
    if (typeof sanitizedData[key] === 'string' && !CHAMP_SECRET.test(key)) {
      sanitizedData[key] = sanitizeHtml(sanitizedData[key] as string, {
        allowedTags: allowedTags,
        allowedAttributes: allowedAttributes,
      }) as T[Extract<keyof T, string>];
    }
  }

  return sanitizedData;
}
