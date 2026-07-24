import { describe, it, expect } from 'vitest';
import { resolveWritingActor } from './resolveWritingActor';
import { APIError } from '../errorHandler/APIError';

describe('resolveWritingActor', () => {
  it("prend l'auteur dans la session, seule source admise", () => {
    expect(resolveWritingActor({ sessionUserId: 'operatrice-olivia' })).toBe('operatrice-olivia');
  });

  it('refuse une écriture sans session : personne ne signerait', () => {
    // Le client n'a plus aucun champ pour désigner l'auteur. Il en avait un (`received_by`, puis
    // `actorUserId`), et une garde vérifiait que l'acteur déclaré était bien membre de
    // l'organisation avec un rôle autorisé. Cette garde empêchait de désigner un ÉTRANGER — mais
    // pas d'usurper un collègue légitime, car la seule pièce d'identité de ce mode était une clé
    // API… compilée dans le bundle mobile, donc extractible par quiconque installe l'application.
    expect(() => resolveWritingActor({})).toThrow(APIError);

    try {
      resolveWritingActor({});
    } catch (error) {
      expect((error as APIError).status).toBe(401);
    }
  });
});
