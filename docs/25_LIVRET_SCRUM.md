# 25 — Livret SCRUM : la trace réelle de la gestion de projet

Pas de tableau Kanban ni de burndown séparé : le pilotage de ce projet vit **dans les trois
dépôts** (API, front, mobile), sous forme d'issues GitHub et de PR qui les ferment
(`Closes #N`). Ce document explique la méthode et pointe vers les preuves, plutôt que de les
dupliquer — un burndown recopié ici se périmerait à la prochaine PR, ce lien non.

## La méthode

1. **Chaque issue porte une conséquence vérifiée dans le code**, pas un vague intitulé. Exemples
   pris tels quels dans le tracker de l'API : « `npm test` renvoie exit 1 — la commande la plus
   évidente pour un correcteur » (#163), « le seuil de couverture de 70 % n'est **jamais**
   évalué — aucun job ne lance `test:coverage` » (#157), « le document de référence ignore
   MongoDB et décrit un middleware supprimé » (#160).
2. **Une PR ferme son issue** (`Closes #N` dans le corps) : l'historique Git *est* le journal de
   sprint. `gh issue list --state closed` et `gh pr list --state merged` reconstituent l'un à
   partir de l'autre à tout moment.
3. **Assignation avant de coder** (`gh issue edit <n> --add-assignee`), pour que deux personnes
   ne travaillent jamais la même chose en parallèle sur les trois dépôts partagés.
4. **Une PR ne s'ouvre que prête à merger** — pas de branche qui traîne à moitié faite.

## Le volume, vérifié au moment de l'écriture de ce document

| Dépôt | Issues fermées | PR mergées |
|---|--:|--:|
| API (`nutrichain-api`) | 64 | 133 |
| Front (`Nutrichain-Front`) | 6 | 26 |
| Mobile (`Nutrichain-Mobile`) | 36 | 61 |

## Repères par thème (échantillon, pas l'inventaire complet)

- **Sécurité / conformité** : verrouillage bruteforce, séparation des tâches HACCP, chaîne
  d'audit WORM, allowlist Better-Auth, 2FA TOTP exposée end-to-end (API #212, front, mobile).
- **Traçabilité / GS1-EPCIS** : lien GS1 Digital Link (API #214), généalogie et rappel côté
  mobile (#77), amont fournisseur côté front (#50).
- **Qualité et CI** : CI réparée (issue historique, close), couverture de test réellement
  évaluée (#157 ouverte au moment de l'écriture — pas encore refermée), Docker/seed en
  conteneur (#155, #156).
- **Ergonomie** : alertes cliquables (front #28), grille figée à l'accueil (mobile #74), session
  expirée qui détruisait une saisie en cours (mobile #73).

## Ce que ce document ne remplace pas

Il ne remplace pas `gh issue list --repo <dépôt> --state closed` ni `gh pr list --state merged`
pour l'inventaire exhaustif à un instant donné — ces commandes font foi, pas un compte figé ici.
