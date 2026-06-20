/**
 * Échappe les caractères HTML dangereux pour éviter une injection XSS
 * lorsqu'une valeur (saisie utilisateur, identifiant) est insérée dans un
 * email HTML ou tout autre rendu HTML.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
