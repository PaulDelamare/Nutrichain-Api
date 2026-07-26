import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

/**
 * #236 — Aucune adresse e-mail ne doit partir dans les journaux applicatifs.
 *
 * Les fichiers de `logs/` ne sont pas versionnés mais ils persistent sur disque, avec rotation :
 * ils survivent donc à l'anonymisation RGPD d'un compte, exactement comme le journal d'audit WORM.
 * Retirer les quelques occurrences existantes ne suffit pas — rien n'empêcherait la suivante.
 *
 * Ce test est un garde-fou statique : il relit les appels `logger.*` du code source et refuse toute
 * interpolation qui transporte une adresse e-mail ou un destinataire. Il couvre notamment
 * `auth.config.ts`, dont les hooks Better-Auth ne sont pas atteignables par un test unitaire.
 *
 * Il ne prétend pas détecter toutes les formes de PII : il verrouille celle qui a été constatée.
 * Un identifiant non-PII (`user.id`) reste évidemment autorisé.
 */

const RACINE_SRC = path.join(process.cwd(), 'src');
const NIVEAUX = ['info', 'warn', 'error', 'debug', 'verbose'];

/** Expressions interdites À L'INTÉRIEUR d'une interpolation `${…}` d'un appel logger. */
const EXPRESSIONS_INTERDITES = [
  /\bemails?\b/i, // user.email, member.email, emails.join(…)
  /\bmail\b/i, // destinataire.mail
  /\bto\b/, // options.to — le destinataire du mailer
];

function fichiersSources(dossier: string, acc: string[] = []): string[] {
  for (const entree of readdirSync(dossier)) {
    const chemin = path.join(dossier, entree);
    if (statSync(chemin).isDirectory()) {
      fichiersSources(chemin, acc);
    } else if (chemin.endsWith('.ts') && !chemin.endsWith('.test.ts')) {
      acc.push(chemin);
    }
  }
  return acc;
}

/** Retire commentaires de ligne et de bloc : un exemple en commentaire n'est pas un appel. */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Extrait le texte de chaque appel `logger.<niveau>(…)`, parenthèses équilibrées — un simple
 * découpage à la ligne raterait les appels multi-lignes, qui sont justement ceux d'`auth.config`.
 */
function appelsLogger(source: string): string[] {
  const appels: string[] = [];
  const debut = new RegExp(`logger\\.(?:${NIVEAUX.join('|')})\\s*\\(`, 'g');

  for (let m = debut.exec(source); m !== null; m = debut.exec(source)) {
    let profondeur = 1;
    let i = m.index + m[0].length;
    for (; i < source.length && profondeur > 0; i++) {
      if (source[i] === '(') profondeur++;
      else if (source[i] === ')') profondeur--;
    }
    appels.push(source.slice(m.index, i));
  }
  return appels;
}

/** Contenu de chaque `${…}` d'un appel. */
function interpolations(appel: string): string[] {
  return [...appel.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]);
}

describe('aucune PII dans les journaux applicatifs (#236)', () => {
  it("aucun appel logger n'interpole d'adresse e-mail ni de destinataire", () => {
    const infractions: string[] = [];

    for (const fichier of fichiersSources(RACINE_SRC)) {
      const source = sansCommentaires(readFileSync(fichier, 'utf-8'));
      for (const appel of appelsLogger(source)) {
        for (const expression of interpolations(appel)) {
          if (EXPRESSIONS_INTERDITES.some((motif) => motif.test(expression))) {
            infractions.push(`${path.relative(process.cwd(), fichier)} → \${${expression}}`);
          }
        }
      }
    }

    expect(infractions).toEqual([]);
  });

  it('se garde lui-même : il repère bien une interpolation fautive', () => {
    const fautif = 'logger.info(\n  `[Hook] Membre créé pour ${user.email}`\n);';
    const trouve = appelsLogger(fautif).flatMap(interpolations);

    expect(trouve).toContain('user.email');
    expect(EXPRESSIONS_INTERDITES.some((motif) => motif.test(trouve[0]))).toBe(true);
    // Un identifiant non-PII reste autorisé.
    expect(EXPRESSIONS_INTERDITES.some((motif) => motif.test('user.id'))).toBe(false);
  });
});
