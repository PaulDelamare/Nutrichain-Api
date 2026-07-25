import { prisma } from '../src/shared/configs/prismaClient.config';
import { signInAsOperator } from './helpers/e2eSession';

/**
 * NUTRICHAIN — Preuve, contre l'API RÉELLE, que le passthrough Better-Auth est réduit à l'allowlist.
 *
 * `router.all('/auth/*')` transmettait tout le core Better-Auth sans traverser notre RBAC ni l'audit :
 * `delete-user`, `change-email`, `change-password`, `get-session`, la gestion des sessions, la 2FA.
 * Seule barrière : la clé API, compilée dans le bundle mobile (pas un secret).
 *
 * Ce script exige que seuls connexion / inscription / déconnexion passent, et que tout le reste
 * réponde 403 — sans que l'authentification soit cassée.
 *
 * Prérequis : `npm run dev` sur une base seedée. Lancement : npm run e2e:auth-allowlist
 */

const API_URL = process.env.API_URL || process.env.API_BASE || 'http://localhost:3000';
const API_KEY = process.env.API_KEY;
const ORG_ID = process.env.API_KEY_ORG_ID;
const ORIGIN = process.env.FRONTEND_URL ?? 'http://localhost:5173';

if (!API_KEY || !ORG_ID) {
  console.error('❌ API_KEY et API_KEY_ORG_ID doivent être définis dans .env');
  process.exit(1);
}

const ok = (msg: string) => console.log(`  ✅ ${msg}`);
const fail = (msg: string): never => {
  throw new Error(msg);
};

/** Routes du core que le passthrough exposait, et que plus aucun client n'utilise. */
const CLOSED_ROUTES: [string, 'POST' | 'GET', unknown][] = [
  ['delete-user', 'POST', {}],
  ['update-user', 'POST', { name: 'Pirate' }],
  ['change-email', 'POST', { newEmail: 'pirate@x.z' }],
  ['change-password', 'POST', { newPassword: 'Hacked!2026', currentPassword: 'x' }],
  ['list-sessions', 'GET', undefined],
  ['revoke-sessions', 'POST', {}],
];

/**
 * Sous-ensemble TOTP réellement enrôlé côté client (front + mobile) : ouvert dans l'allowlist,
 * donc CETTE route doit atteindre le VRAI handler Better-Auth (jamais 403), quelle que soit sa
 * réponse (400 sur un code invalide, ici). Une seule route suffit à prouver le câblage — les
 * trois autres (`enable`, `get-totp-uri`, `disable`) partagent le même point d'entrée dans
 * `ALLOWED_AUTH_ROUTES` et sont couvertes exhaustivement, sans coût réseau, par
 * `allowAuthRoutes.middleware.test.ts`. Chaque appel ici consomme le même budget de
 * rate-limiting (`authRateLimiter`, 20 échecs/15 min/IP) que partagent TOUS les scripts e2e sur
 * ce runner — en ajouter davantage a déjà fait déborder un script e2e plus tardif en CI.
 */
const OPEN_TWO_FACTOR_ROUTE: [string, 'POST', unknown] = [
  'two-factor/verify-totp',
  'POST',
  { code: '000000' },
];

async function main() {
  console.log('\n🔒 Passthrough Better-Auth — allowlist stricte\n');

  const { token } = await signInAsOperator(prisma, {
    apiBase: API_URL,
    apiKey: API_KEY!,
    organizationId: ORG_ID!,
    email: 'e2e-viewer@nutrichain.local',
    role: 'viewer',
  });
  ok('POST /auth/sign-in/email → connexion réussie (route autorisée)');

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY!,
    Authorization: `Bearer ${token}`,
    Origin: ORIGIN,
  };

  for (const [action, method, body] of CLOSED_ROUTES) {
    const res = await fetch(`${API_URL}/api/auth/${action}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status !== 403) {
      fail(`/auth/${action} répond ${res.status} au lieu de 403 — le passthrough est encore ouvert.`);
    }
    ok(`${method} /auth/${action} → 403`);
  }

  {
    const [action, method, body] = OPEN_TWO_FACTOR_ROUTE;
    const res = await fetch(`${API_URL}/api/auth/${action}`, {
      method,
      headers,
      body: JSON.stringify(body),
    });
    if (res.status === 403) {
      fail(`/auth/${action} répond 403 — la route TOTP enrôlée par les clients est encore fermée.`);
    }
    ok(`${method} /auth/${action} → ${res.status} (pas 403 : atteint le vrai handler)`);
  }

  // get-session : la session ne doit se lire que par /api/me (route à nous), jamais par le core.
  const getSession = await fetch(`${API_URL}/api/auth/get-session`, { headers });
  if (getSession.status !== 403) fail(`/auth/get-session répond ${getSession.status} au lieu de 403.`);
  ok('GET /auth/get-session → 403');

  // Non-régression : /api/me (la vraie lecture de session) et la déconnexion fonctionnent.
  const me = await fetch(`${API_URL}/api/me`, { headers });
  if (me.status !== 200) fail(`/api/me répond ${me.status} : l'authentification est cassée.`);
  ok('/api/me → 200 : lecture de session intacte');

  const signOut = await fetch(`${API_URL}/api/auth/sign-out`, { method: 'POST', headers });
  if (signOut.status !== 200) fail(`/auth/sign-out répond ${signOut.status} au lieu de 200.`);
  ok('POST /auth/sign-out → 200 : la déconnexion fonctionne toujours');

  console.log('\n✅ Seuls connexion / inscription / déconnexion passent ; le reste du core est fermé.\n');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`);
  await prisma.$disconnect();
  process.exit(1);
});
