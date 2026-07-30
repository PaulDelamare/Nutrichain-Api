/** Un SSCC nu : 18 chiffres, clé de contrôle comprise. */
export const SSCC_PATTERN = /^(00)?\d{18}$/;

/**
 * Retire l'AI `00` que la lecture d'une étiquette conserve.
 *
 * L'étiquette de palette encode l'element string GS1 complet (`00` + 18 chiffres) : c'est ce
 * qu'une caméra rend. Les identifiants persistés, eux, sont les 18 chiffres seuls. Sans ce
 * retrait, un code parfaitement valide ne résout aucune palette.
 *
 * Partagé plutôt que recopié : la règle vivait dans le contrôleur de scan, et tout nouvel appelant
 * qui l'oubliait rendait un 404 sur une lecture correcte.
 */
export function stripSsccAi(sscc: string): string {
  return sscc.length === 20 ? sscc.slice(2) : sscc;
}
