# 16 — Invitation & Register Flow (intégration Frontend)

> **Audience** : Hugo (frontend Svelte) — comment intégrer le flow d'invitation/inscription.

## 1. Vue d'ensemble

```
ADMIN (front) ──┐
                ▼
        POST /api/identity/invitations
                │
                ▼
        DB: Invitation { status='pending', id=UUID, expiresAt }
                │
                ▼
        ✉️ EMAIL → user.email
        avec lien {FRONTEND_URL}/register?token={invitation.id}
                │
                ▼
USER (front) ──── clic sur le lien
                │
                ▼
        SVELTE /register?token=...
        formulaire : email + password + name + token (depuis la query)
                │
                ▼
        POST /api/auth/sign-up/email  body: { email, password, name, token }
                │
                ▼
        requireInvitationOrFirstUser : (id=token, email) doit matcher une Invitation pending non-expirée
                │
                ▼
        Better-Auth crée le User + hook databaseHooks.user.create.after :
          - updateMany atomique → Invitation.status='accepted' (un seul winner concurrent)
          - crée Member { userId, organizationId: invitation.org, role: invitation.role }
                │
                ▼
        Session active : cookie HttpOnly pour web, header `set-auth-token` pour mobile (Bearer)
```

## 2. Côté admin : envoyer une invitation

**Endpoint** : `POST /api/identity/invitations`
**Auth** : session admin/owner (cookie ou Bearer) + clé API
**Rôle requis** : `owner` ou `admin` dans l'org active

**Body** :
```json
{
  "email": "new.operator@usine.com",
  "role": "operator",
  "organizationId": "{{activeOrgId}}"
}
```

> ⚠️ Le champ `organizationId` est **ignoré côté serveur** — l'invitation est toujours créée dans l'org de la session (`req.auth.activeOrgId`). Il est gardé dans le payload pour cohérence métier mais ne sert pas. Le front peut l'omettre.

**Réponse 201** (enveloppe `sendSuccess`) :
```json
{
  "status": 201,
  "message": "Invitation générée et envoyée avec succès.",
  "data": {
    "invitationId": "uuid",
    "expiresAt": "2026-06-05T12:34:56.000Z"
  }
}
```

**Erreurs possibles** :
- `400` : payload invalide (email mal formé, rôle hors enum) ou utilisateur déjà existant pour cet email
- `401` : pas authentifié
- `403` : pas le rôle owner/admin dans l'org active

### Exemple Svelte (envoi d'invitation)

```typescript
// src/lib/api/invitations.ts
import { PUBLIC_API_URL, PUBLIC_API_KEY } from '$env/static/public';

export async function inviteUser(email: string, role: string, organizationId: string) {
  const res = await fetch(`${PUBLIC_API_URL}/api/identity/invitations`, {
    method: 'POST',
    credentials: 'include', // cookie session
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': PUBLIC_API_KEY,
    },
    body: JSON.stringify({ email, role, organizationId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.[0]?.message ?? `Invite failed: ${res.status}`);
  }
  return res.json();
}
```

## 3. Côté user invité : recevoir l'email

L'email contient un bouton CTA qui pointe vers :
```
{FRONTEND_URL}/register?token={invitation.id}
```

`FRONTEND_URL` est configurée dans le `.env` de l'API (REQUIS au boot via `assertEnv`). En dev : `http://localhost:5173`, en prod : URL publique du Svelte.

## 4. Côté front : page `/register`

À l'arrivée sur `/register?token=...`, le front doit :

1. Lire le query param `token` (UUID v4)
2. Si absent → afficher "Lien invalide, demandez à votre admin de vous renvoyer une invitation"
3. Afficher un formulaire avec `email`, `password`, `name`
4. À la soumission, POST vers Better-Auth sign-up avec `{ email, password, name, token }`

### Endpoint sign-up

`POST /api/auth/sign-up/email`
**Auth** : juste la clé API (le user n'existe pas encore)

**Body** :
```json
{
  "email": "new.operator@usine.com",
  "password": "MotDePasseFort1!",
  "name": "Marie Dupont",
  "token": "uuid-de-l-invitation"
}
```

> ⚠️ Le `token` est **OBLIGATOIRE** dès qu'au moins un utilisateur existe en DB. Seul le tout premier sign-up du système (bootstrap "First Admin") peut omettre le token. Un sign-up sans token sur une DB peuplée retourne **403**.

**Réponses** :

- `200` : compte créé, session active. Le body est celui retourné nativement par Better-Auth, typiquement :
  ```json
  {
    "user": {
      "id": "uuid",
      "email": "...",
      "name": "...",
      "emailVerified": false,
      "createdAt": "...",
      "updatedAt": "..."
    },
    "token": "..."  // présent uniquement pour le flow Bearer (mobile)
  }
  ```
  - **Web** : un cookie HttpOnly Better-Auth est posé. Le front n'a rien à stocker, `credentials: 'include'` suffit pour les appels suivants.
  - **Mobile** : le token Bearer est renvoyé dans le header `set-auth-token` et dans le body (via plugin `bearer`). À stocker en SecureStore/Keychain et envoyer en `Authorization: Bearer ...` sur chaque appel suivant.

- `400` : payload invalide (email mal formé, password trop faible — voir `passwordRule`, name < 2 chars, token mal formé UUID)
- `403` : `Création de compte refusée. Vous n'avez pas d'invitation valide ou elle a expiré.`
  - Le message est identique pour `pas d'invitation`, `invitation expirée`, `token mismatch`, `email/token incohérents` — **anti-enumeration**.

### Format d'erreur (toutes routes API)

Toutes les erreurs API utilisent la même enveloppe via `APIError` :
```json
{
  "status": 403,
  "error": [
    { "field": "auth", "message": "Création de compte refusée. ..." }
  ]
}
```

Le front lit `body.error[0].field` et `body.error[0].message`. Plusieurs erreurs simultanées (ex: VineJS) génèrent plusieurs items dans le tableau.

### Exemple Svelte (page register)

```svelte
<!-- src/routes/register/+page.svelte -->
<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { PUBLIC_API_URL, PUBLIC_API_KEY } from '$env/static/public';

  let email = '';
  let password = '';
  let name = '';
  let error = '';

  // Récupère le token depuis la query string
  $: token = $page.url.searchParams.get('token') ?? '';

  async function handleSubmit() {
    error = '';
    const res = await fetch(`${PUBLIC_API_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      credentials: 'include', // important pour le cookie Better-Auth
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': PUBLIC_API_KEY,
      },
      body: JSON.stringify({ email, password, name, token }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      error = body?.error?.[0]?.message ?? 'Erreur inconnue';
      return;
    }
    // Session créée — redirige vers le dashboard
    goto('/');
  }
</script>

{#if !token}
  <p>Lien invalide. Demandez à votre administrateur de vous renvoyer une invitation.</p>
{:else}
  <form on:submit|preventDefault={handleSubmit}>
    <input type="email" bind:value={email} placeholder="Email" required />
    <input type="password" bind:value={password} placeholder="Mot de passe" required />
    <input type="text" bind:value={name} placeholder="Prénom Nom" required />
    <button type="submit">Créer mon compte</button>
    {#if error}
      <p class="error">{error}</p>
    {/if}
  </form>
{/if}
```

> Note : pas besoin d'un `<input type="hidden">` pour le token — il est lu directement depuis la query par le handler JS et inclus dans le body POST.

## 5. CORS & cookies

L'API doit autoriser le frontend pour les requêtes credentialed :
- `Access-Control-Allow-Origin` : valeur exacte de `FRONTEND_URL` (jamais `*` avec cookies)
- `Access-Control-Allow-Credentials: true`
- Le middleware CORS du projet est configuré dans `src/shared/configs/apiConfigMiddleware.config.ts`

Côté front, **toujours** envoyer `credentials: 'include'` sur les fetch vers l'API si tu utilises le cookie de session.

## 6. Ce qui se passe automatiquement après sign-up

Le hook `databaseHooks.user.create.after` dans `auth.config.ts` :

1. Cherche une `Invitation` pending pour cet email
2. **Consommation atomique** : `prisma.invitation.updateMany({ where: { id, status: 'pending' }, data: { status: 'accepted' } })`. Si `count === 0` (autre transaction concurrente a déjà consommé), on n'enrôle pas en double et on log un warn.
3. Crée le `Member` dans `invitation.organizationId` avec `invitation.role`
4. Si aucune invitation (= 1er user du système) → crée une org "Siège Central" + role 'owner'

Donc le front n'a rien à faire en plus après le sign-up. La session retournée a déjà l'utilisateur prêt.

## 7. Cas d'erreur côté front

| Code | Champ | Message API typique | Action front |
|---|---|---|---|
| `400` | `email` | "Doit être une adresse email" | Afficher sous le champ email |
| `400` | `password` | "Mot de passe trop faible" | Afficher sous le champ password |
| `400` | `name` | "Trop court" | Afficher sous le champ name |
| `400` | `token` | "Doit être un UUID" | "Lien invalide, redemandez une invitation" |
| `403` | `auth` | "Création de compte refusée. Vous n'avez pas d'invitation valide ou elle a expiré." | Message générique, suggérer de redemander |

## 8. Anti-spam & expiration

- **Expiration** : configurable via `INVITATION_EXPIRATION_DAYS` (`src/modules/identity/constants/roles.constants.ts`). Une invitation expirée est rejetée même si pending.
- **Cleanup auto** : cron quotidien `src/modules/identity/jobs/cleanupInvitations.job.ts` purge les `pending` expirées.
- **Re-invite same email** : `POST /api/identity/invitations` supprime d'abord les anciennes pending pour cet email avant de créer la nouvelle (le token précédent devient inutilisable).

## 9. ⚠️ Deux systèmes d'invitation existent

Le projet a deux systèmes d'invitation parallèles (héritage du choix de Better-Auth + besoin métier custom) :

| Système | Endpoint | Email lien | Statut |
|---|---|---|---|
| **Custom (canonique)** | `POST /api/identity/invitations` | `{FRONTEND_URL}/register?token=...` | ✅ À utiliser |
| Better-Auth organization plugin | `auth.api.createInvitation(...)` (via SDK) | Idem depuis cette PR | Inactif tant qu'on ne l'appelle pas |

**Recommandation** : utiliser uniquement le **custom** (`POST /api/identity/invitations`). Le plugin `organization` de Better-Auth est conservé pour `auth.api.getFullOrganization` (utilisé par `requireOrgRole` middleware), mais son `sendInvitationEmail` n'est jamais déclenché tant qu'aucun code ne fait appel à son endpoint d'invitation natif. Si tu vois un email de Better-Auth, c'est qu'on a basculé — me prévenir.

## 10. Test E2E manuel rapide

1. Lancer l'API : `npm run dev`
2. **DB vide** : POST `/api/auth/sign-up/email` body `{ email, password, name }` → bypass first-user
3. Login admin via `POST /api/auth/sign-in/email`
4. POST `/api/identity/invitations` avec session admin + body invitation
5. Vérifier les logs API : Ethereal affiche le lien email → doit pointer sur `http://localhost:5173/register?token=...`
6. Aller manuellement sur `http://localhost:5173/register?token=<token>` côté Svelte
7. Soumettre le formulaire → vérifier 200 + cookie `better-auth.session_token` posé + `invitation.status === 'accepted'` en DB

## See also

- `docs/01_analyse_authentification.md` — vision globale auth
- `docs/02_roles_et_permissions.md` — matrice ABAC
- `src/modules/identity/auth.config.ts` — config Better-Auth + hooks
- Swagger : `/api-docs` une fois l'API démarrée

---

*Cette doc accompagne la branche `feat/invitation-frontend-url`.*
