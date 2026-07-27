import { expect, describe, it } from 'vitest';
import { sanitizeDataWithHtml } from './sanitizeStringData';

describe('sanitizeDataWithHtml', () => {
  it('should sanitize HTML by removing disallowed tags', () => {
    const input = {
      title: '<h1>Title</h1>',
      description: '<p>Description <a href="#">link</a></p>',
    };
    const allowedTags = ['p', 'a'];
    const allowedAttributes = { a: ['href'] };

    const result = sanitizeDataWithHtml(input, allowedTags, allowedAttributes);

    expect(result.title).toBe('Title');
    expect(result.description).toBe('<p>Description <a href="#">link</a></p>');
  });

  it('should remove all HTML tags if no allowed tags are specified', () => {
    const input = {
      title: '<h1>Title</h1>',
      content: '<div>Some <strong>content</strong></div>',
    };

    const result = sanitizeDataWithHtml(input, []);

    expect(result.title).toBe('Title');
    expect(result.content).toBe('Some content');
  });

  it('should keep allowed attributes on tags', () => {
    const input = {
      description: '<a href="https://example.com" target="_blank">Click here</a>',
    };
    const allowedTags = ['a'];
    const allowedAttributes = {
      a: ['href', 'target'],
    };

    const result = sanitizeDataWithHtml(input, allowedTags, allowedAttributes);

    expect(result.description).toBe('<a href="https://example.com" target="_blank">Click here</a>');
  });

  it('should ignore non-string fields', () => {
    const input = {
      name: 'John',
      age: 30,
      description: '<p>Valid HTML</p>',
    };
    const allowedTags = ['p'];

    const result = sanitizeDataWithHtml(input, allowedTags);

    expect(result.age).toBe(30);
    expect(result.description).toBe('<p>Valid HTML</p>');
  });

  /**
   * #245 — Un mot de passe ne sort jamais en HTML : il va au hachage. L'assainir ne protège donc
   * rien, et le faire avec `allowedTags: []` SUPPRIME le contenu de ce qui ressemble à une balise.
   * Un mot de passe `abc<def123456` était haché comme `abc` : trois caractères, sans un mot à
   * l'utilisateur. L'exemption est le comportement PAR DÉFAUT de la fonction — un appelant ne peut
   * pas l'oublier.
   */
  describe('champs de secret (#245)', () => {
    it('laisse intact un mot de passe contenant ce qui ressemble à une balise', () => {
      const result = sanitizeDataWithHtml({ password: 'Pa$$w0rd<Secret>2026!' });

      expect(result.password).toBe('Pa$$w0rd<Secret>2026!');
    });

    it('laisse intact un mot de passe tronqué par un chevron ouvrant seul', () => {
      // Le cas le plus violent : `sanitizeHtml` supprimait tout ce qui suit le `<`.
      const result = sanitizeDataWithHtml({ password: 'abc<def123456' });

      expect(result.password).toBe('abc<def123456');
    });

    it("n'échappe pas l'esperluette d'un mot de passe", () => {
      // `a&b` devenait `a&amp;b` : le secret stocké n'était plus celui saisi.
      const result = sanitizeDataWithHtml({ password: 'a&b&c123456' });

      expect(result.password).toBe('a&b&c123456');
    });

    it('couvre toute la famille des champs de mot de passe', () => {
      const input = {
        newPassword: 'a<b>1',
        currentPassword: 'c<d>2',
        confirmPassword: 'e&f3',
      };

      const result = sanitizeDataWithHtml(input);

      expect(result.newPassword).toBe('a<b>1');
      expect(result.currentPassword).toBe('c<d>2');
      expect(result.confirmPassword).toBe('e&f3');
    });

    it('continue d assainir les champs métier, y compris ceux nommés « code »', () => {
      // Garde-fou : l'exemption doit rester étroite. `code` est un champ MÉTIER de ce dépôt
      // (code d'unité, `qr_code_id`), et il est affiché — il doit rester assaini.
      const input = {
        nom: '<script>alert(1)</script>Ferme Bio',
        code: '<b>KG</b>',
        note_technique: '<img src=x onerror=alert(1)>',
      };

      const result = sanitizeDataWithHtml(input);

      expect(result.nom).toBe('Ferme Bio');
      expect(result.code).toBe('KG');
      expect(result.note_technique).toBe('');
    });
  });
});
