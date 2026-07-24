import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Transporte l'invitation RÉELLEMENT validée, du middleware d'inscription jusqu'au hook qui enrôle
 * l'utilisateur dans son organisation.
 *
 * Pourquoi ce détour : le hook de création d'utilisateur ne reçoit que l'utilisateur, pas la requête.
 * Il re-cherchait donc l'invitation **par e-mail seul**. Si le même e-mail avait deux invitations en
 * attente dans deux organisations, Postgres en rendait une arbitrairement — l'organisation et le
 * rôle attribués n'étaient pas ceux du jeton présenté (#95). Un administrateur d'une organisation
 * pouvait ainsi détourner l'accueil d'un utilisateur invité ailleurs.
 *
 * `AsyncLocalStorage` conserve la valeur pour toute la chaîne asynchrone d'UNE requête : deux
 * inscriptions simultanées ne peuvent pas se voler leur contexte.
 */
const storage = new AsyncLocalStorage<{ invitationId: string }>();

/** Exécute la suite du traitement en mémorisant l'invitation validée pour cette requête. */
export const runWithValidatedInvitation = <T>(invitationId: string, continuation: () => T): T =>
  storage.run({ invitationId }, continuation);

/**
 * L'invitation validée pour la requête en cours, ou `undefined` hors inscription — c'est-à-dire
 * pour le tout premier utilisateur du système, qui n'a pas d'invitation.
 */
export const getValidatedInvitationId = (): string | undefined => storage.getStore()?.invitationId;
