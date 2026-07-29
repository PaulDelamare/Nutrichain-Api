import { escapeHtml } from '../../../../shared/utils/html/escapeHtml';

/**
 * Rendu de la page que voit un CONSOMMATEUR en scannant l'étiquette d'un produit.
 *
 * Fonction pure, sans Express : elle se teste seule, comme `renderDashboardHtml`.
 *
 * Le scan renvoyait le JSON brut de l'API — des accolades et un statut en majuscules devant
 * quelqu'un qui tient un pot de yaourt. L'alerte de rappel, seule raison d'être de ce canal,
 * y passait inaperçue (#285).
 */

export interface PublicScanView {
  lot: {
    numero_lot: string;
    date_peremption: Date | null;
    nom_produit: string;
    gtin: string;
    producteur: string;
    statut_sanitaire: string;
  };
  trace: {
    etapes: number;
    message: string;
    etapes_details: { produit: string; date: Date }[];
    origines: { ferme: string }[];
  };
}

const formatDate = (date: Date | null): string | null =>
  date ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' }).format(date) : null;

/** Une ligne du tableau d'identité, omise plutôt que rendue vide quand la valeur manque. */
const ligne = (libelle: string, valeur: string | null): string =>
  valeur ? `<tr><th>${escapeHtml(libelle)}</th><td>${escapeHtml(valeur)}</td></tr>` : '';

export const renderPublicScanHtml = (vue: PublicScanView): string => {
  const { lot, trace } = vue;
  const rappele = lot.statut_sanitaire === 'RAPPEL_CONSOMMATEUR';

  // L'alerte est rendue AVANT le nom du produit : sur un téléphone, ce qui compte doit tenir
  // dans le premier écran, sans défilement.
  const alerte = rappele
    ? `<div class="alerte" role="alert">
      <strong>Ne pas consommer</strong>
      <p>Ce lot fait l'objet d'un rappel produit. Rapportez-le à votre point de vente.</p>
    </div>`
    : '';

  const origines = trace.origines.length
    ? `<section>
      <h2>Origine</h2>
      <ul>${trace.origines.map((o) => `<li>${escapeHtml(o.ferme)}</li>`).join('')}</ul>
    </section>`
    : '';

  const etapes = trace.etapes_details.length
    ? `<section>
      <h2>Ingrédients tracés</h2>
      <ul>${trace.etapes_details.map((e) => `<li>${escapeHtml(e.produit)}</li>`).join('')}</ul>
    </section>`
    : '';

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(lot.nom_produit)} — traçabilité NutriChain</title>
<style>
  :root { color-scheme: light dark; --encre: #14231c; --papier: #fff; --doux: #f2f5f3; --trait: #dde5e0; --accent: #1f7a5a; --alerte: #b3261e; --alerte-fond: #fdecea; }
  @media (prefers-color-scheme: dark) {
    :root { --encre: #e8efea; --papier: #101714; --doux: #172420; --trait: #2a3a34; --accent: #59c49b; --alerte: #ff8a80; --alerte-fond: #2c1512; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 18px 56px; background: var(--papier); color: var(--encre);
         font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 34rem; margin: 0 auto; }
  .marque { font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); margin: 0 0 18px; }
  .alerte { background: var(--alerte-fond); border-left: 5px solid var(--alerte); border-radius: 6px; padding: 16px 18px; margin: 0 0 22px; }
  .alerte strong { display: block; color: var(--alerte); font-size: 21px; margin-bottom: 4px; }
  .alerte p { margin: 0; }
  h1 { font-size: 25px; line-height: 1.25; margin: 0 0 4px; }
  .producteur { color: var(--accent); margin: 0 0 22px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 26px; }
  th, td { text-align: left; padding: 10px 0; border-bottom: 1px solid var(--trait); vertical-align: top; }
  th { font-weight: 500; color: inherit; opacity: .7; width: 45%; }
  td { font-variant-numeric: tabular-nums; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .06em; opacity: .7; margin: 24px 0 8px; }
  ul { margin: 0; padding-left: 20px; }
  .trace { background: var(--doux); border-radius: 6px; padding: 16px 18px; margin-top: 26px; }
  .trace p { margin: 0; }
  footer { margin-top: 32px; font-size: 13px; opacity: .6; }
</style>
</head>
<body>
<main>
  <p class="marque">NutriChain — traçabilité</p>
  ${alerte}
  <h1>${escapeHtml(lot.nom_produit)}</h1>
  <p class="producteur">${escapeHtml(lot.producteur)}</p>
  <table>
    ${ligne('Numéro de lot', lot.numero_lot)}
    ${ligne('À consommer avant le', formatDate(lot.date_peremption))}
    ${ligne('Code produit (GTIN)', lot.gtin)}
  </table>
  ${origines}
  ${etapes}
  <div class="trace"><p>${escapeHtml(trace.message)}</p></div>
  <footer>Information fournie par le producteur via NutriChain.</footer>
</main>
</body>
</html>`;
};
