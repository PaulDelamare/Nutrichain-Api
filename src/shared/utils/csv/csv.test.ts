import { describe, it, expect } from 'vitest';
import { parseCsv, toCsv } from './csv';

describe('csv adapter', () => {
  it('parse un CSV avec en-tête en lignes objets (en-têtes/cellules trimés)', () => {
    const { rows, errors } = parseCsv('nom , code\n Lait , 123 \nBeurre,456');
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { nom: 'Lait', code: '123' },
      { nom: 'Beurre', code: '456' },
    ]);
  });

  it('gère les champs entre guillemets contenant une virgule', () => {
    const { rows } = parseCsv('nom,adresse\nACME,"12 rue A, 75001 Paris"');
    expect(rows[0].adresse).toBe('12 rue A, 75001 Paris');
  });

  it('ignore les lignes vides', () => {
    const { rows } = parseCsv('nom\nLait\n\n\nBeurre\n');
    expect(rows.map((r) => r.nom)).toEqual(['Lait', 'Beurre']);
  });

  it('sérialise des lignes en CSV dans l ordre des colonnes', () => {
    const csv = toCsv([{ code: '1', nom: 'Lait' }], ['nom', 'code']);
    expect(csv).toBe('nom,code\r\nLait,1');
  });

  it('échappe les valeurs contenant une virgule à la sérialisation', () => {
    const csv = toCsv([{ a: 'x,y' }], ['a']);
    expect(csv).toBe('a\r\n"x,y"');
  });

  it('roundtrip parse → toCsv stable', () => {
    const src = 'nom,code\r\nLait,1\r\nBeurre,2';
    const { rows } = parseCsv(src);
    expect(toCsv(rows, ['nom', 'code'])).toBe(src);
  });

  it.each(['=SUM(A1)', '+1+1', '-2+3', '@cmd'])(
    'neutralise l injection de formule CSV (cellule dangereuse : %s)',
    (payload) => {
      // La valeur est préfixée d'une apostrophe pour être interprétée comme texte.
      expect(toCsv([{ a: payload }], ['a'])).toBe(`a\r\n'${payload}`);
    }
  );

  it('ne modifie pas une valeur texte normale', () => {
    expect(toCsv([{ a: 'Lait' }], ['a'])).toBe('a\r\nLait');
  });
});
