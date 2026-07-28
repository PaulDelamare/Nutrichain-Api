import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { getAuthTables } from 'better-auth/db';
import { auth } from './auth.config';

/**
 * Better-Auth écrit DIRECTEMENT dans ses tables, sans passer par notre code : si une montée de
 * version ajoute une colonne que `schema.prisma` ne déclare pas, Prisma rejette l'écriture et
 * l'endpoint répond 500.
 *
 * Ce que ça a coûté : la montée 1.6.5 → 1.6.25 a ajouté `failedVerificationCount` et `lockedUntil`
 * à `twoFactor`. `POST /auth/two-factor/enable` répondait 500 avec un corps VIDE — l'erreur venant
 * du gestionnaire de la bibliothèque, elle n'atteignait même pas nos journaux. La suite était
 * verte : tous les tests d'authentification mockent `toNodeHandler`, donc AUCUN n'exécute le vrai
 * pipeline Better-Auth. Le défaut n'a été trouvé qu'en appelant l'API à la main.
 *
 * Ce test ferme la classe entière, sans base de données : il confronte le schéma que Better-Auth
 * déclare pour la configuration réellement chargée (plugins compris) au modèle Prisma généré.
 */
describe('conformité du schéma Better-Auth avec Prisma', () => {
  const prismaModels = new Map(
    Prisma.dmmf.datamodel.models.map((model) => [
      model.dbName ?? model.name,
      new Set(model.fields.map((field) => field.dbName ?? field.name)),
    ])
  );

  const authTables = getAuthTables(auth.options);

  it('déclare toutes les tables que Better-Auth utilise', () => {
    const manquantes = Object.values(authTables)
      .map((table) => table.modelName)
      .filter((modelName) => !prismaModels.has(modelName));

    expect(manquantes).toEqual([]);
  });

  it('déclare tous les champs que Better-Auth écrit', () => {
    const manquants: string[] = [];

    for (const table of Object.values(authTables)) {
      const colonnes = prismaModels.get(table.modelName);
      if (!colonnes) continue; // Table absente : déjà signalée par le test précédent.

      for (const [nomChamp, champ] of Object.entries(table.fields)) {
        // `fieldName` est le nom en base quand il diffère de la clé de configuration.
        const colonne = champ.fieldName ?? nomChamp;
        if (!colonnes.has(colonne)) {
          manquants.push(`${table.modelName}.${colonne}`);
        }
      }
    }

    expect(manquants).toEqual([]);
  });
});
