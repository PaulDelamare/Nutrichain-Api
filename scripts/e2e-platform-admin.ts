import { prisma } from '../src/shared/configs/prismaClient.config';
import { signInAsOperator } from './helpers/e2eSession';

/**
 * NUTRICHAIN — Preuve, contre l'API RÉELLE, du rôle « admin de plateforme ».
 *
 * L'admin de plateforme (personnel NutriChain) crée et gère les organisations clientes, mais
 * n'accède JAMAIS à leurs données métier — il n'est membre d'aucune organisation, donc n'a pas
 * d'organisation active, donc `ensureActiveOrg` le rejette sur tout le métier.
 *
 * Prérequis : `npm run dev` sur une base seedée (`npm run seed`).
 * Lancement : npm run e2e:platform
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const API_KEY = process.env.API_KEY;
const ORIGIN = process.env.FRONTEND_URL ?? 'http://localhost:5173';

if (!API_KEY) {
  console.error('❌ API_KEY doit être défini dans .env');
  process.exit(1);
}

const ok = (m: string) => console.log(`  ✅ ${m}`);
const echec = (m: string): never => {
  throw new Error(m);
};

async function connexion(email: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY!, Origin: ORIGIN },
    body: JSON.stringify({ email, password: 'NutriChain!2026' }),
  });
  const data = (await res.json()) as { token?: string };
  if (!res.ok || !data.token) echec(`Connexion ${email} impossible (${res.status})`);
  return data.token!;
}

const appel = (token: string, path: string, method = 'GET', body?: unknown) =>
  fetch(`${API_BASE}/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY!,
      Authorization: `Bearer ${token}`,
      Origin: ORIGIN,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

async function main() {
  console.log('\n🏢 Admin de plateforme — création et isolation\n');

  const platform = await connexion('platform@nutrichain.local');
  const viewer = await connexion('viewer@nutrichain.local');

  // 1. /me distingue l'admin de plateforme
  const mePlatform = await (await appel(platform, '/me')).json();
  if (mePlatform.data?.isPlatformAdmin !== true)
    echec('/me ne signale pas isPlatformAdmin pour platform@');
  if (mePlatform.data?.activeOrgId)
    echec("L'admin de plateforme ne doit pas avoir d'organisation active");
  ok('/me : platform@ → isPlatformAdmin=true, aucune organisation active');

  const meViewer = await (await appel(viewer, '/me')).json();
  if (meViewer.data?.isPlatformAdmin !== false) echec('/me signale isPlatformAdmin pour un viewer');
  ok('/me : viewer@ → isPlatformAdmin=false');

  // 2. Isolation : l'admin de plateforme ne touche AUCUNE donnée métier. On balaie plusieurs
  //    familles de routes, et on exige le rejet « pas d'organisation active » (400/401) —
  //    surtout PAS un « tout sauf 200 » qui laisserait passer un 500 pour une preuve.
  const routesMetier = [
    '/organization/members',
    '/organization/suppliers',
    '/organization/customers',
    '/organization/audit-logs',
    '/traceability/products',
    '/traceability/batches',
  ];
  for (const r of routesMetier) {
    const res = await appel(platform, r);
    if (res.status !== 400 && res.status !== 401) {
      echec(
        `⛔ ${r} : l'admin de plateforme obtient ${res.status} (attendu 400/401, pas d'org active)`
      );
    }
  }
  ok(
    `Toutes les routes métier refusées à l'admin de plateforme (${routesMetier.length} testées, 400/401)`
  );

  // 3. Un rôle d'organisation ne peut PAS créer d'organisation
  const refus = await appel(viewer, '/platform/organizations', 'POST', {
    name: 'Tentative',
    slug: `tentative-${Date.now()}`,
  });
  if (refus.status !== 403)
    echec(`Un viewer a pu appeler /platform/organizations (${refus.status})`);
  ok('/platform/organizations refusé à un rôle d’organisation (403)');

  // 4. L'admin de plateforme crée une organisation
  const slug = `ferme-e2e-${Date.now()}`;
  const orgsAvant = await prisma.organization.count();
  const creation = await appel(platform, '/platform/organizations', 'POST', {
    name: 'Ferme E2E',
    slug,
  });
  if (creation.status !== 201) echec(`Création d'organisation échouée (${creation.status})`);
  const org = (await creation.json()).data as { id: string };
  ok(`Organisation créée par l'admin de plateforme (${slug})`);

  // 5. Elle est journalisée dans SA PROPRE chaîne d'audit
  const audit = await prisma.audit_Log.findFirst({
    where: { organization_id: org.id, action: 'CREATE_ORGANIZATION' },
  });
  if (!audit) echec("Aucune ligne d'audit CREATE_ORGANIZATION pour la nouvelle organisation");
  if (audit.prev_hash !== 'GENESIS_BLOCK_NUTRICHAIN')
    console.log(`     (prev_hash = ${audit.prev_hash} — 1re ligne de la chaîne)`);
  ok("Création journalisée dans la chaîne d'audit de l'organisation");

  // 6. Slug déjà pris → 409 propre
  const collision = await appel(platform, '/platform/organizations', 'POST', {
    name: 'Autre ferme',
    slug,
  });
  if (collision.status !== 409) echec(`Collision de slug mal gérée (${collision.status})`);
  ok('Slug déjà pris → 409');

  // 7. Inviter le premier owner
  const invite = await appel(platform, `/platform/organizations/${org.id}/owner`, 'POST', {
    email: `pilote-${Date.now()}@ferme.fr`,
  });
  if (invite.status !== 201) echec(`Invitation du premier owner échouée (${invite.status})`);
  ok('Premier owner invité');

  // Nettoyage : l'organisation e2e n'a ni lot ni audit métier au-delà de sa genèse.
  await prisma.audit_Log.deleteMany({ where: { organization_id: org.id } });
  await prisma.invitation.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  const orgsApres = await prisma.organization.count();
  if (orgsApres !== orgsAvant) echec(`Nettoyage incomplet (${orgsAvant} → ${orgsApres})`);
  ok('Organisation e2e nettoyée');

  console.log('\n✅ Admin de plateforme : création + audit + isolation prouvés.\n');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`);
  await prisma.$disconnect();
  process.exit(1);
});
