import { prisma } from '../src/shared/configs/prismaClient.config';
import { signInAsOperator } from './helpers/e2eSession';

/**
 * NUTRICHAIN — Preuve, contre l'API RÉELLE, que le plugin `organization` de Better-Auth n'est plus
 * joignable par HTTP.
 *
 * Le contexte : `router.all('/auth/*')` est un passthrough TOTAL. Tout le plugin passait donc à
 * travers, sans jamais traverser notre RBAC ni l'audit WORM. Constaté avant correctif, en HTTP réel :
 *
 *   POST /api/auth/organization/create, appelé par un VIEWER (lecture seule) → 200
 *   → il devenait `owner` de l'organisation ainsi créée.
 *
 * Et `POST /auth/organization/delete` supprime une organisation EN CASCADE : membres, lots, et le
 * journal d'audit WORM avec — un journal inviolable, effaçable par une route non tracée.
 *
 * Ce script rejoue le scénario avec le rôle LE PLUS FAIBLE et exige un refus.
 *
 * Prérequis : `npm run dev` sur une base seedée (`npm run seed`).
 * Lancement : npm run e2e:org-passthrough
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
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

/** Chemins mutatifs du plugin : chacun contourne le RBAC maison et l'audit WORM. */
const MUTATIONS = [
  ['create', { name: 'Org e2e', slug: `org-e2e-${Date.now()}` }],
  ['update', { data: { name: 'Renommée' } }],
  ['delete', { organizationId: ORG_ID }],
  ['set-active', { organizationId: ORG_ID }],
  ['invite-member', { email: 'x@y.z', role: 'admin' }],
  ['remove-member', { memberIdOrEmail: 'x@y.z' }],
  ['update-member-role', { memberId: 'x', role: 'owner' }],
  ['leave', { organizationId: ORG_ID }],
] as const;

async function main() {
  console.log('\n🔒 Passthrough Better-Auth — le plugin organization doit être fermé\n');

  // Le rôle le plus faible : s'il est refusé, tout le monde l'est.
  const { token } = await signInAsOperator(prisma, {
    apiBase: API_BASE,
    apiKey: API_KEY!,
    organizationId: ORG_ID!,
    email: 'e2e-viewer@nutrichain.local',
    role: 'viewer',
  });

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY!,
    Authorization: `Bearer ${token}`,
    Origin: ORIGIN,
  };

  const orgsBefore = await prisma.organization.count();

  for (const [action, body] of MUTATIONS) {
    const res = await fetch(`${API_BASE}/api/auth/organization/${action}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (res.status !== 403) {
      fail(
        `/auth/organization/${action} répond ${res.status} au lieu de 403 — le passthrough est ouvert.`
      );
    }
    ok(`/auth/organization/${action} → 403`);
  }

  // Les lectures aussi : `list` révélait les organisations des AUTRES clients.
  const list = await fetch(`${API_BASE}/api/auth/organization/list`, { headers });
  if (list.status !== 403) fail(`/auth/organization/list répond ${list.status} au lieu de 403.`);
  ok('/auth/organization/list → 403');

  const orgsAfter = await prisma.organization.count();
  if (orgsAfter !== orgsBefore) {
    fail(`Le nombre d'organisations a changé (${orgsBefore} → ${orgsAfter}) : une écriture a abouti.`);
  }
  ok(`Aucune organisation créée ni supprimée (${orgsBefore} avant, ${orgsAfter} après)`);

  // Non-régression : l'authentification, elle, doit continuer de fonctionner.
  const session = await fetch(`${API_BASE}/api/me`, { headers });
  if (session.status !== 200) fail(`/api/me répond ${session.status} : l'authentification est cassée.`);
  ok("/api/me → 200 : l'authentification n'est pas affectée");

  console.log('\n✅ Le plugin organization est fermé, et la connexion fonctionne toujours.\n');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`);
  await prisma.$disconnect();
  process.exit(1);
});
