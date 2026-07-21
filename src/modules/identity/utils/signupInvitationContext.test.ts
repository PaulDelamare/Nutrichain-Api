import { describe, it, expect } from 'vitest';
import {
  getValidatedInvitationId,
  runWithValidatedInvitation,
} from './signupInvitationContext';

describe('contexte d’inscription', () => {
  it("expose l'invitation validée à la suite du traitement, y compris après un await", async () => {
    const vu = await runWithValidatedInvitation('inv-a', async () => {
      await new Promise((r) => setTimeout(r, 1));
      return getValidatedInvitationId();
    });

    expect(vu).toBe('inv-a');
  });

  it('ne fuit rien hors de la requête', () => {
    runWithValidatedInvitation('inv-a', () => undefined);

    expect(getValidatedInvitationId()).toBeUndefined();
  });

  it('isole deux inscriptions simultanées', async () => {
    // Sans isolation, la seconde requête écraserait le contexte de la première et l'utilisateur
    // serait enrôlé dans l'organisation de quelqu'un d'autre.
    const lire = (id: string) =>
      runWithValidatedInvitation(id, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getValidatedInvitationId();
      });

    const [a, b] = await Promise.all([lire('inv-a'), lire('inv-b')]);

    expect(a).toBe('inv-a');
    expect(b).toBe('inv-b');
  });
});
