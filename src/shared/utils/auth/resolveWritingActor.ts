import { APIError } from '../errorHandler/APIError';

interface ResolveWritingActorParams {
  /** Identité issue de la session authentifiée. C'est la SEULE source admise. */
  sessionUserId?: string;
}

/**
 * Qui signe une écriture ? Cette identité est scellée dans la chaîne d'audit WORM : elle vient de
 * la session, et de nulle part ailleurs.
 *
 * Le client n'a plus aucun champ pour la déclarer. Il en avait un (`received_by`, puis
 * `actorUserId`), et une garde vérifiait que l'acteur déclaré était bien membre de l'organisation
 * avec un rôle autorisé. Cette garde empêchait de désigner un ÉTRANGER — mais pas d'usurper un
 * collègue légitime, puisque la seule pièce d'identité de ce mode était une clé API… compilée dans
 * le bundle de l'application mobile, donc extractible par quiconque l'installe.
 *
 * Une intégration machine (ERP/WMS) se connecte donc avec un COMPTE DE SERVICE — un utilisateur,
 * des identifiants, une session, et une révocation possible.
 */
export function resolveWritingActor({ sessionUserId }: ResolveWritingActorParams): string {
  if (!sessionUserId) {
    throw new APIError(401, {
      error: [
        {
          field: 'auth',
          message: "Auteur non identifié : cette écriture requiert un utilisateur authentifié.",
        },
      ],
    });
  }

  return sessionUserId;
}
