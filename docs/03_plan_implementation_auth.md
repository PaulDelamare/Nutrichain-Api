# Plan d'Implémentation : Système d'Authentification (Better Auth + ABAC)

Ce document trace la feuille de route exacte, étape par étape, pour implémenter notre architecture d'authentification complète de manière sécurisée et modulaire.

## 🔴 Phase 1 : Infrastructure & Base de données (Schéma)

*L'objectif de cette phase est de mettre en place le socle de sécurité sans rien casser.*

1. **Installation des dépendances**
   - Installer le cœur : `npm install better-auth`
   - Installer l'adaptateur ORM : `npm install @better-auth/prisma`
   - Installer les éventuels types ou utilitaires requis.

2. **Configuration centrale de Better Auth**
   - Créer le fichier `src/Configs/auth.config.ts`.
   - Configurer l'adaptateur Prisma.
   - Activer les plugins nécessaires : `twoFactor` (MFA OTP) et configurer l'approche Headless API (Bearer Tokens pour le mobile, Cookies HttpOnly pour le web).

3. **Génération Automatique du Schéma (CLI Better Auth)**
   - Exécuter `npx @better-auth/cli generate` pour que le framework lise `auth.config.ts` et injecte automatiquement et sans erreur ses propres tables (`User`, `Session`, `Account`, `Verification`, `TwoFactor`) dans notre fichier `prisma/schema.prisma`.

4. **Enrichissement Manuel du Schéma (Notre Modèle ABAC)**
   - Dans `schema.prisma`, ajouter les champs métiers obligatoires à la table `User` générée (ex: `matricule`, `isActive`).
   - Ajouter l'énumération `Permission`.
   - Créer la table `Lieu` (Usine, Entrepôt, etc.).
   - Créer la table `RoleTemplate` (Modèle de rôle avec ses permissions).
   - Créer la table pivot `UserRoleAssignment` avec ses contraintes temporelles (`startDate`, `endDate`).
   - Lier correctement `UserRoleAssignment` à la table `User`.

5. **Migration de la base de données**
   - Lancer `npx prisma migrate dev --name init_better_auth_abac` pour pousser les changements dans PostgreSQL.

---

## 🟢 Phase 2 : Cycle TDD & Logique Métier (Services)

*L'objectif est de s'assurer en amont que la logique répond au cahier des charges (Red-Green-Refactor).*

1. **Test des Inscriptions et Invitations**
   - Créer `src/Services/auth/auth.service.test.ts`.
   - Rédiger les tests : "Un Manager peut inviter un employé", "Un invité peut définir son mot de passe".
   - Implémenter la logique dans `auth.service.ts`.

2. **Test du Login & MFA**
   - Rédiger les tests : "Le login retourne une session/token", "Le login échoue si l'utilisateur est inactif", "Le MFA est requis si activé".
   - Implémenter la logique sous-jacente s'interfaçant avec l'instance Better Auth.

---

## 🟡 Phase 3 : Middlewares & Gardes d'Authentification

1. **Middleware de vérification de Session**
   - Créer un middleware Express `requireAuth` qui lit et valide le Cookie (Svelte) ou le Bearer Token (Mobile) via Better Auth.
   - Injecter l'utilisateur dans l'objet `req` (`req.user`).

2. **Middleware ABAC (Contrôle d'accès granulaire)**
   - Créer un middleware `requirePermission(action)`.
   - Logique : "Est-ce que `req.user` possède l'action X pour le Lieu Y demandé dans `req.body.lieu_id` ?".
   - S'assurer que les rôles bloqués ou expirés (vérification de `endDate`) sont rejetés.

---

## 🔵 Phase 4 : Routes & Contrôleurs (Exposition de l'API)

1. **Câblage des routes natives de Better Auth**
   - Monter le routeur généré par Better Auth (ex: `app.use("/api/auth", auth.handler)`).
   
2. **Construction des routes "Métiers" (Administration)**
   - `POST /api/users/invite` (Protégé par ABAC `USER_INVITE`).
   - `PUT /api/users/:id/disable` (Protégé par ABAC `USER_MANAGE`).
   - `GET /api/users/me/permissions` (Pour que l'UI frontend sache quels menus afficher).

3. **Validation et Error Handling**
   - Protéger l'entrée des routes avec le validateur `vinejs` (existant).
   - Englober les contrôleurs avec le wrap `logFunction` et `errorHandler` pour le monitoring WORM et empêcher la fuite des Stack Traces en cas d'erreur.