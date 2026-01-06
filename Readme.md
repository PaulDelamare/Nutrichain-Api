# NutriChain API — Surveillance de la chaîne du froid ❄️

## 🔎 Présentation
**NutriChain** est une REST API dédiée à la traçabilité complète des lots et à la surveillance de la chaîne du froid en temps réel. Elle ingère des événements EPCIS (standards GS1), collecte les mesures des capteurs IoT (température) et alerte automatiquement en cas d'excursion thermique.

> Objectif : garantir la sécurité sanitaire, l'auditabilité et la rapidité d'intervention (ingest→alerte p95 cible < 30s).

## 🎯 Objectifs principaux (résumé)

- Traçabilité EPCIS conforme GS1 pour 100% des lots du MVP.
- Alerte froide en < 30s (p95).
- Authentification OIDC + MFA + autorisation ABAC.
- Latence de scan < 500 ms et disponibilité mobile > 99,5%.
- Processus de rappel complet < 15 minutes.

## ⚙️ Prérequis

- Node.js (version LTS recommandée)
- npm ou yarn
- PostgreSQL (base de données configurée)

## 🔽 Récupération du projet

Cloner et installer :

```bash
git clone https://github.com/PaulDelamare/Nutrichain-Api.git
cd nutrichain-api
npm install
```

## 📁 Structure du projet

Extrait de l'arborescence :

```
logs/
node_modules/
prisma/
src/
  ├── Configs/
  ├── Controllers/
  ├── Routes/
  ├── Services/
  ├── Middlewares/
  ├── Utils/
  ├── app.ts
  ├── server.ts
```

## 🧾 Migrations / Prisma

- Définir les modèles dans `prisma/schema.prisma`.
- Générer le client Prisma : `npx prisma generate`.
- Appliquer les migrations : `npm run migrate` (ou `npx prisma migrate dev`).

Exemple de modèle :

```prisma
model User {
  id    Int     @id @default(autoincrement())
  name  String
  email String  @unique
}
```

## 💡 Remarques

Ce dépôt contient une implémentation API pour NutriChain. Le code est organisé pour faciliter l'évolution (tests, validation, logging). Veille à ne **jamais** committer de secrets (`.env`) et à maintenir une couverture de tests pour le code critique.

## 🔧 Démarrage

### Installer les dépendances

```bash
npm install
```

### Appliquer les migrations

```bash
npm run migrate
# ou : npx prisma migrate dev
```

### Lancer l'application en développement

```bash
npm run dev
```

### Lancer en production

```bash
npm start
```

### Tests

```bash
npm run unit:test
```

## 🔐 Variables d'environnement

Créer un fichier `.env` à la racine et renseigner les variables nécessaires (ex. `DATABASE_URL`, `PORT`, `LOG_DIR`, variables OIDC). Exemple :

```env
DATABASE_URL="postgresql://user:pass@localhost:5432/nutrichain"
PORT=3000
LOG_DIR=logs
NODE_ENV=development
# OIDC_*, MFA_* etc. selon la configuration d'authentification
```

## 🙋 Contribuer

Les contributions sont les bienvenues : fork → branche feature → PR avec description. Merci d'ajouter des tests et d'indiquer les changements techniques majeurs dans la PR.
