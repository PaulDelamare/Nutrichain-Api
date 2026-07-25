# 26 — Support d'oral, minutage, et plan B

Montage à partir de matière déjà écrite (`20_DOSSIER_SOUTENANCE.md`), pas de contenu nouveau.
Trois livrables distincts : le déroulé chronométré, la checklist de répétition, et le plan B
en cas de panne réseau/démo — sous forme de **captures**, pas de relance de script (une CLI qui
défile n'est pas une preuve visuelle convaincante en direct).

## 1. Déroulé chronométré (30 min d'exposé)

Budget total 30 min. Les temps sont des **cibles à chronométrer en répétition**, pas des mesures
déjà prises — cf. §2.

| Bloc | Contenu | Cible |
|---|---|---|
| Intro | Le problème (`20_DOSSIER_SOUTENANCE.md` §1) | 3 min |
| Réponse | Ce que fait NutriChain, en une phrase par capacité (§2) | 2 min |
| Architecture | Les 3 décisions structurantes (§4), pas les 5 diagrammes en détail | 3 min |
| **Démo pas-à-pas** | Les 12 étapes du scénario (§5) | **17 min** |
| Sécurité/limites | Un point fort (séparation des tâches HACCP) + assumer 1-2 limites (§7) | 3 min |
| Conclusion | Chiffres clés (§9) + KPI (§10) | 2 min |

### Répartition des 17 min de démo (12 étapes, §5)

Les étapes qui ne produisent qu'une ligne de résultat (import, étiquette) vont vite ; celles qui
ont un effet visible et racontent une histoire (quarantaine, rappel, alerte froid) méritent plus
de temps à l'oral — c'est là que le jury voit la valeur, pas dans l'import CSV.

| Étape | Temps cible |
|---|---|
| 1. Import ERP | 1 min |
| 2. Réception fournisseur | 1 min |
| 3. Étiquette GS1 | 30 s |
| 4-5. Quarantaine + séparation des tâches (403 puis levée) | **3 min** — le point le plus démonstratif de la rigueur HACCP |
| 6. Transformation + généalogie | 1,5 min |
| 7. Expédition + SSCC | 1 min |
| 8. Excursion chaîne du froid | **2,5 min** — alerte + quarantaine automatique, montrer le délai |
| 9. Rappel produit | **2,5 min** — le chrono en millisecondes est l'argument à appuyer |
| 10. Scan consommateur | 1 min |
| 11. Export EPCIS | 1 min |
| 12. Preuve d'intégrité WORM | 1 min |

Total : 16,5 min — 30 s de marge pour un aléa (question, redémarrage d'écran).

## 2. Répétition chronométrée — ce qui reste à faire

**Non fait à ce stade** : la répétition elle-même n'a pas eu lieu, donc aucun temps réel n'est
mesuré. Protocole pour la faire :

1. Lancer la préparation complète (`prisma migrate deploy`, `db seed`, `seed:demo`, `npm run dev`).
2. Dérouler les 12 étapes avec la collection Bruno, chronomètre en main, sans s'arrêter pour
   corriger — noter les blocages plutôt que les résoudre en direct.
3. Comparer le temps réel à la cible ci-dessus ; ajuster la cible ou la démo (pas les deux en
   même temps) si l'écart dépasse 20 %.
4. Répéter au moins une fois **avec les questions** : demander à quelqu'un d'interrompre au
   hasard, pour s'entraîner à reprendre le fil sans perdre le fil du chrono.

## 3. Plan B — captures de secours

Le scénario e2e rejouable (§5, note « Plan B démo ») prouve que le système fonctionne, mais une
CLI qui défile ne se substitue pas à une démonstration visuelle devant un jury. Il faut, en plus,
une capture **par étape à fort impact visuel**, prise à l'avance, montrable sans réseau :

| Étape | Artefact à capturer | Format |
|---|---|---|
| 4-5. Quarantaine + séparation des tâches | Réponse 403 puis levée réussie | Capture d'écran (Bruno ou front) |
| 8. Excursion chaîne du froid | Alerte créée + lot passé en `BLOQUE` | Capture d'écran, ou courte vidéo (l'enchaînement compte) |
| 9. Rappel produit | Chrono affiché + descendance en `ALERTE` | Capture d'écran |
| 10. Scan consommateur | Écran `RAPPEL_CONSOMMATEUR` | Capture d'écran |
| 12. Preuve d'intégrité | Résultat `GET /api/audit/verify` | Capture d'écran |

**Ce qui n'est PAS encore fait** : ces captures ne sont pas produites — ce tableau définit quoi
capturer, pas la preuve elle-même. Les générer suppose un run complet du scénario (serveur +
seed + Bruno ou front), à faire séparément et à date proche de l'oral pour rester représentatif
de l'état du code.

**Leçon déjà tirée** (rappelée dans l'issue #82) : tout ce qui dépend du réseau de la salle doit
avoir un repli — le scan caméra en dépendait et a été corrigé (Mobile PR #28). Les captures
ci-dessus sont ce repli pour la démo API : elles ne dépendent d'aucun réseau le jour J.
