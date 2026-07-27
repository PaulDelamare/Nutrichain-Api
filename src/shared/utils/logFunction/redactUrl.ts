/**
 * Masque les segments d'URL qui portent un secret, AVANT toute écriture dans un journal (#253).
 *
 * Le jeton d'invitation voyageait dans le chemin (`/identity/invitations/:token/preview`), et les
 * deux journalisations de requête écrivent l'URL complète — `logs/app-*.log` (plus la console) et
 * `logs/request.log`. Or ce jeton n'est pas un identifiant secondaire : c'est l'id d'invitation, la
 * seule pièce que `sign-up` exige en plus de l'e-mail, et `previewInvitation` le convertit
 * justement en e-mail + rôle sous la seule clé API. Qui lisait `logs/` pouvait donc devenir membre
 * au rôle invité — jusqu'à `owner` pour une invitation émise depuis la console plateforme.
 *
 * Le paradoxe valait d'être fermé : `docs/22_JOURNALISATION_SIEM.md` désigne `logs/` comme point
 * d'ingestion du collecteur, et `logs/request.log` n'est borné par aucune durée de conservation. Le
 * dispositif présenté comme une mesure de sécurité était devenu le vecteur.
 *
 * ⚠️ Cette liste est une liste NOMMÉE, pas une heuristique : elle ne protège que ce qu'on y déclare.
 * Un test de garde (`redactUrl.test.ts`) échoue si une route déclare un paramètre de chemin qui
 * ressemble à un secret sans être couvert ici — c'est lui qui empêche la prochaine route d'y
 * échapper en silence.
 */
const SEGMENTS_SENSIBLES: { motif: RegExp; remplacement: string }[] = [
  {
    // `/api/identity/invitations/<jeton>/preview` — le jeton est l'id d'invitation.
    motif: /(\/identity\/invitations\/)[^/?#]+/gi,
    remplacement: '$1[masqué]',
  },
];

/** Ce qui compte comme « secret » dans un nom de paramètre de chemin, pour le test de garde. */
export const PARAMS_SENSIBLES = /^:(token|code|secret|key|jeton)$/i;

export function redactUrl(url: string): string {
  let masquee = url;
  for (const { motif, remplacement } of SEGMENTS_SENSIBLES) {
    masquee = masquee.replace(motif, remplacement);
  }
  return masquee;
}
