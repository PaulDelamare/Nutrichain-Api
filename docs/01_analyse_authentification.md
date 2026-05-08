# Analyse et Conception : Système d'Authentification NutriChain

## 1. Contexte et Enjeux

D'après le fichier `context.md` et les objectifs SMART du projet, la sécurisation des accès est un point de friction majeur (**Objectif 3 : Sécurisation avancée des accès et de l'identité** d'ici le 01/03/2026).
- **Enjeux** : OIDC, MFA obligatoire pour les actions critiques, Contrôle d'accès ABAC (Attribute-Based Access Control).
- **Réglementation** : Outils utilisés dans un contexte normé (HACCP, ISO 22000, traçabilité inviolable/WORM). 

Le projet se base sur l'architecture de type **N-Tiers / Modulaire (Modulith)**, avec Node.js, Express, Prisma (PostgreSQL).

## 2. Définition des concepts (Ce que vous recherchiez)

Le concept de "*faire les tests avant de faire la fonction*" s'appelle le **TDD** (**Test-Driven Development**, ou Développement Dirigé par les Tests).
Le principe est simple (Cycle *Red-Green-Refactor*) :
1. Écrire le test d'une fonctionnalité non existante (il échoue : *Red*).
2. Écrire le code minimal pour faire passer le test (il réussit : *Green*).
3. Nettoyer et optimiser le code en gardant le test au vert (*Refactor*).

## 3. L'Application des principes SOLID pour l'Authentification

Pour garantir un code extrêmement propre (Clean Architecture / Modulith), voici comment nous utiliserons les principes SOLID pour ce module :

1. **Single Responsibility Principle (SRP)** : 
   - Le `AuthController` ne fera QUE gérer la requête Express (req, res).
   - Le `AuthService` ne fera QUE la logique d'orchestration de connexion/inscription.
   - Les composants lourds comme le hachage du mot de passe (`HashService`) ou la création de token (`TokenService`) auront leurs propres fichiers dédiés.
2. **Open/Closed Principle (OCP)** :
   - Si nous voulons ajouter demain une connexion "Google OIDC" par dessus le login classique, nous ne modifierons pas le Login existant. Nous ajouterons un nouveau "Strategy/Service" sans casser l'existant.
3. **Liskov Substitution Principle (LSP)** & **Interface Segregation Principle (ISP)** :
   - En TypeScript, nous définirons des Interfaces strictes (ex: `ITokenManager`) pour ne pas être couplé à une librairie comme `jsonwebtoken` de façon définitive.
4. **Dependency Inversion Principle (DIP)** :
   - Les contrôleurs dépendront des interfaces/abstractions des services (via Inversion de Dépendance), facilitant ainsi grandement l'écriture des tests unitaires via des *Mocks* (simulacres).

## 4. Proposition de Structure de Fichiers (Module Auth)

Je me suis inspiré de la structure existante (qui est déjà nativement excellente avec les tests à côté des fichiers). Nous allons isoler l'authentification dans un domaine ou dossier dédié :

```text
src/
  Auth/                       <-- Domaine isolé pour respecter le Modulith
    Controllers/
      auth.controller.ts
      auth.controller.test.ts
    Services/
      auth.service.ts
      auth.service.test.ts
      token.service.ts       <-- Gère JWT / OIDC
      hash.service.ts        <-- Gère Bcrypt/Argon2
    Middlewares/
      requireAuth.middleware.ts
      requireMFA.middleware.ts
      abac.middleware.ts     <-- Contrôle des accès selon attributs
    Routes/
      auth.routes.ts
    DTOs/                    <-- Data Transfer Objects (Validation VineJS)
      login.dto.ts
      register.dto.ts
```

## 5. Notes et Stratégies pour l'IA (Mes "Pensées")

- **Validation** : Continuer d'utiliser `VineJS` (vu dans `validateData.test.ts`) pour vérifier les DTOs (Données envoyées par l'utilisateur lors du login) en amont, avant de toucher au service.
- **Sécurité Base de Données (`bdd.md`)** : Nécessite une table "Users" orientée RBAC/ABAC. L'opérateur final sera souvent attaché à un `Materiel` ou à un `Lot`. Les logs doivent être WORM (Write Once Read Many).
- **État d'esprit** :
  - **Ne pas coder de fonction sans avoir fait son `.test.ts` vide avec les `describe/it` décrivant l'intention.**
  - **Faire de petites PR** : Login / Gérer Token / Gérer RBAC / Gérer MFA. Pas tout d'une traite.
  - Toujours s'assurer que le Contrôleur capte les erreurs via le `errorHandler` existant, pour ne pas exposer de "Stack Trace" (infos sensibles) à l'extérieur.

## 6. Prochaines Étapes Communes

Pour ne pas coder tout de suite et valider mon analyse, voici ce que je propose comme prochaine étape lorsque vous serez prêt :

1. **Création du schéma Prisma** : Ajouter/Mettre à jour les modèles `User`, `Role`, `Session` (pour gérer les tokens de rafraîchissement) dans la base de données.
2. **Setup des interfaces (DIP)** : Écrire les interfaces des Cryptographies de mot de passe et de génération de Tokens.
3. **Cycle TDD 1** : Créer le fichier `auth.service.test.ts`, y décrire ce que doit faire un "login" sécurisé.
4. Écrire le code de `auth.service.ts` pour verdir ce test.

## 7. Réflexion DIY (Do It Yourself) vs Bibliothèque Dédiée (Better Auth / Lucia)

Suite à notre discussion, la création d'un système d'authentification 100% maison (DIY) pour gérer :
- MFA (SMS, Email, Authenticator)
- OIDC (OpenID Connect)
- Refresh Tokens & Invalidation de Session
- Accessibilité sécurisée depuis React Native (Mobile)

...est extrêmement risquée et coûteuse en temps. Le faire soi-même entraîne souvent des failles de sécurité classiques (fuite de token, vols de session).

**Recommandation** : Utiliser un framework moderne côté serveur.
- **Better Auth** (Très récent, Framework Agnostique, gère parfaitement Prisma et le mobile) ou **Lucia Auth** (Excellent pour gérer des sessions en base de données adaptées au cross-platform).

## 8. L'approche « Headless API » avec Better Auth (Mise à jour d'Architecture)

Pour répondre à votre architecture : **Web (Svelte = Dashboard)** + **Mobile (React Native = Scans offline/usines)** + **API centralisée**.

Depuis ses récentes mises à jour, Better Auth excelle dans le découplage backend/frontend. Cependant, Svelte et React Native ne consomment pas l'authentification de la même manière :
- **Svelte (Web)** : Sera connecté via des **Cookies (HttpOnly, Secure)** envoyés automatiquement par l'API. C'est inattaquable via XSS.
- **React Native (Mobile)** : Ne peut pas facilement gérer les cookies (problèmes de webviews / CORS origin). Nous allons forcer Better Auth à utiliser son mode d'API à « Tokens » (Bearer Token) pour le mobile, qui sera stocké localement dans le téléphone (SecureStore/Keychain).

### Gestion du 2FA (MFA)
L'option **Application Authenticator (TOTP)** + **Codes de secours** + **Email** est la plus sécurisée.
On utilisera le plugin officiel de Better Auth : `@better-auth/two-factor`. Cela s'intègre parfaitement avec des applications mobiles industrielles (un chef d'équipe avec un YubiKey ou Google Authenticator sur tablette durcie).

### Zoom sur le modèle ABAC (La sécurité contextuelle)
L'exemple de *Jean dans l'Entrepôt Nord* est le cas d'école parfait de l'ABAC (Attribute-Based Access Control).
Plutôt que de dire « Jean est Rôle ADMIN », on dira « Jean » a l'attribut « lieu_id = Entrepôt Nord » et l'attribut « habilitation = RECEVOIR_MARCHANDISE ».

**Comment on va le lier dans Prisma ?**
1. Table **User** (gérée par Better Auth)
2. Table pivot **User_Lieu_Habilitations** (Lien entre User, Lieu et une Habilitation spécifique).
3. Un **Middleware Express personnalisé** qui vérifiera avant chaque route que :
   - Le profil de Jean l'autorise sur cette route.
   - Les paramètres de la requête (`req.body.id_lieu`) correspondent bien aux habilitations ABAC en mémoire.

---
### ✅ Validation demandée de votre part
Est-ce que cette séparation des environnements (Web=Cookie / Mobile=Token) et cette approche pour gérer les habilitations par *Lieu/Attribut* vous convient ?
Si c'est un GO 👍, la prochaine action consistera à écrire officiellement le début du `schema.prisma` pour implémenter ces tables de base.

## 9. Précisions Fonctionnelles (Post-Réflexion)

### Gestion des Utilisateurs (Onboarding et SSO)
L'inscription ne sera possible que par **Invitation** (par L'Admin ou le Manager).
- Le responsable d'un *Lieu* (ex: Chef d'Entrepôt Nord) aura la permission d'envoyer un mail d'invitation contenant un Token sécurisé, permettant au nouvel employé de définir son mot de passe.
- Nous ajouterons les champs personnalisés `isActive` (bloquer sans supprimer pour garder la traçabilité WORM) et `matricule` (ID interne RH).

### Expérience Mobile et Maintien de Session (Scans)
L'application mobile sert principalement au scan rapide en usine. Il est impensable de demander un login complet (Email + Mot de passe + MFA) chaque jour.

**Résolution technique :**
- Connexion initiale : Setup lourd (Mot de passe + TOTP). Cette étape retourne un très long **Refresh Token** (conservé dans le *SecureStore* du téléphone) et un *Access Token* (qui expire vite, ex: 15 min).
- Au quotidien : Le téléphone utilise le *Refresh Token* pour se reconnecter silencieusement en fond.
- Côté UI Mobile (React Native) : On n'obligera l'utilisateur à taper qu'un **Code PIN à 4 ou 6 chiffres**, ou à utiliser FaceID/TouchID pour valider qu'il est bien lui, avant de lancer le requêtage API grâce aux tokens conservés. C'est le design pattern classique de l'industrie logistique ou bancaire.

### Envoi d'E-mails
Le projet étant un MVP d'école (Fil Rouge), nous ne nous attacherons pas à un vrai fournisseur SMTP (comme SendGrid) pour ne pas payer. Nous allons implémenter un service **Simulé (Logs Terminal)**, ou utiliser **Nodemailer avec Ethereal / Mailtrap** (service de test gratuit qui intercepte les emails pour les afficher sur un faux dashboard web).

### Impact sur le Schéma Prisma de départ
Better Auth génère et requiert des tables natives spécifiques. Nous ne les modifions pas (sauf pour ajouter nos champs `matricule`, `isActive`).
Le schéma initial concernera :
1. Les 4 tables natives de Better Auth (`User`, `Session`, `Account` (OAuth/Passkeys), `Verification`).
2. Les tables du plugin MFA (`TwoFactor`).
3. Notre table `Lieu`.
4. Notre table pivot ABAC (`UserLieuRole`) qui liera les responsables à leurs utilisateurs.
