import { describe, it, expect } from 'vitest';
import { renderPublicScanHtml } from './renderPublicScanHtml';

const conforme = {
  lot: {
    numero_lot: '260725-M78HPZ',
    date_peremption: new Date('2027-07-25T23:59:59.999Z'),
    nom_produit: 'Yaourt nature 125 g',
    gtin: '3000000000017',
    producteur: 'Usine Laitière de Paris',
    statut_sanitaire: 'CONFORME',
  },
  trace: {
    etapes: 1,
    message: 'Ce produit a été tracé depuis « Ferme Bio de Paris » jusqu\'à vous via NutriChain.',
    etapes_details: [{ produit: 'Lait cru', date: new Date('2026-07-01T08:00:00Z') }],
    origines: [{ ferme: 'Ferme Bio de Paris' }],
  },
};

const rappele = {
  ...conforme,
  lot: { ...conforme.lot, statut_sanitaire: 'RAPPEL_CONSOMMATEUR' },
};

describe('renderPublicScanHtml', () => {
  it('rend une page lisible portant le produit, le producteur et le lot', () => {
    const html = renderPublicScanHtml(conforme);

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Yaourt nature 125 g');
    expect(html).toContain('Usine Laitière de Paris');
    expect(html).toContain('260725-M78HPZ');
    expect(html).toContain('Ferme Bio de Paris');
  });

  // Le canal est PUBLIC et sa raison d'être est l'alerte : un rappel qui se lit comme une ligne
  // de plus au milieu des autres ne sert à rien. Il doit se voir avant tout le reste.
  it('affiche une alerte explicite quand le lot est rappelé', () => {
    const html = renderPublicScanHtml(rappele);

    expect(html).toContain('Ne pas consommer');
    // Devant le titre visible (`<h1>`), pas devant le `<title>` de l'onglet.
    expect(html.indexOf('Ne pas consommer')).toBeLessThan(html.indexOf('<h1>'));
  });

  it("n'affiche aucune alerte quand le lot est conforme", () => {
    const html = renderPublicScanHtml(conforme);

    expect(html).not.toContain('Ne pas consommer');
  });

  // Le nom du produit vient de la base, qui est alimentée par un import CSV client : il n'est
  // pas de confiance. Sans échappement, un nom de produit devient du script dans le navigateur
  // de chaque consommateur qui scanne.
  it('echappe le HTML des valeurs affichees', () => {
    const html = renderPublicScanHtml({
      ...conforme,
      lot: { ...conforme.lot, nom_produit: '<img src=x onerror=alert(1)>' },
    });

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('reste lisible quand le lot n a ni DLC ni origine connue', () => {
    const html = renderPublicScanHtml({
      lot: { ...conforme.lot, date_peremption: null },
      trace: { etapes: 0, message: 'Ce produit a été tracé jusqu\'à vous.', etapes_details: [], origines: [] },
    });

    expect(html).toContain('Yaourt nature 125 g');
    expect(html).not.toContain('null');
    expect(html).not.toContain('undefined');
  });

  // La page est lue sur un telephone, dans un rayon : la balise viewport n'est pas cosmetique.
  it('declare un viewport mobile et la langue', () => {
    const html = renderPublicScanHtml(conforme);

    expect(html).toContain('name="viewport"');
    expect(html).toContain('lang="fr"');
  });
});
