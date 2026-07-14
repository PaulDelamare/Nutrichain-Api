import { prisma } from '../src/shared/configs/prismaClient.config';

/**
 * NUTRICHAIN — Preuve, contre l'API RÉELLE, de la gestion des membres.
 *
 * Changer un rôle / révoquer un accès, réservé aux administrateurs et journalisé. Gardes de
 * sécurité : on ne touche jamais le propriétaire, ni soi-même ; `owner` n'est pas assignable ;
 * une révocation est effective immédiatement (requireOrgRole re-vérifie l'appartenance).
 *
 * Prérequis : `npm run dev` sur une base seedée. Lancement : npm run e2e:members
 */

const API = 'http://localhost:3000/api';
const KEY = process.env.API_KEY!;
const ORIGIN = process.env.FRONTEND_URL ?? 'http://localhost:5173';

const ok = (m: string) => console.log(`  ✅ ${m}`);
const echec = (m: string): never => {
  throw new Error(m);
};

async function connexion(email: string): Promise<string> {
  const res = await fetch(`${API}/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY, Origin: ORIGIN },
    body: JSON.stringify({ email, password: 'NutriChain!2026' }),
  });
  const d = (await res.json()) as { token?: string };
  if (!res.ok || !d.token) echec(`Connexion ${email} impossible (${res.status})`);
  return d.token!;
}

const call = (token: string, path: string, method = 'GET', body?: unknown) =>
  fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-api-key': KEY,
      Authorization: `Bearer ${token}`,
      Origin: ORIGIN,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

async function main() {
  console.log('\n👥 Gestion des membres\n');

  const admin = await connexion('admin@nutrichain.local'); // owner
  const adminDemo = await connexion('admin.demo@nutrichain.local'); // admin
  const operator = await connexion('operator@nutrichain.local');

  const members = (await (await call(admin, '/organization/members')).json()).data as {
    id: string;
    userId: string;
    role: string;
    user: { email: string };
  }[];
  const find = (email: string) => members.find((m) => m.user.email === email)!;
  const mOwner = find('admin@nutrichain.local');
  const mQuality = find('quality@nutrichain.local');
  const mOperator = find('operator@nutrichain.local');
  const mViewer = find('viewer@nutrichain.local');

  // 1. Un opérateur ne gère pas les membres
  const refus = await call(operator, `/organization/members/${mViewer.id}/role`, 'PATCH', {
    role: 'admin',
  });
  if (refus.status !== 403) echec(`operator a pu changer un rôle (${refus.status})`);
  ok('Gestion des membres refusée à un opérateur (403)');

  // 2. On ne peut pas poser le rôle owner (escalade)
  const esc = await call(admin, `/organization/members/${mOperator.id}/role`, 'PATCH', {
    role: 'owner',
  });
  if (esc.status !== 400 && esc.status !== 422) echec(`rôle owner accepté (${esc.status})`);
  ok("Poser le rôle 'owner' refusé par la validation");

  // 3. On ne touche pas l'owner
  const coup = await call(adminDemo, `/organization/members/${mOwner.id}/role`, 'PATCH', {
    role: 'admin',
  });
  if (coup.status !== 403) echec(`un admin a pu toucher l'owner (${coup.status})`);
  ok('Toucher le propriétaire refusé (403)');

  // 4. On ne se change pas soi-même
  const mAdminDemo = find('admin.demo@nutrichain.local');
  const soi = await call(adminDemo, `/organization/members/${mAdminDemo.id}/role`, 'PATCH', {
    role: 'viewer',
  });
  if (soi.status !== 403) echec(`un admin a pu changer son propre rôle (${soi.status})`);
  ok('Changer son propre rôle refusé (403)');

  // 5. Changement de rôle légitime : quality → operator, puis retour (audité)
  const chg = await call(admin, `/organization/members/${mQuality.id}/role`, 'PATCH', {
    role: 'operator',
  });
  if (chg.status !== 200) echec(`changement de rôle légitime échoué (${chg.status})`);
  const audit = await prisma.audit_Log.count({
    where: { action: 'CHANGE_MEMBER_ROLE', entity_id: mQuality.id },
  });
  if (audit < 1) echec('changement de rôle non journalisé');
  ok('Changement de rôle légitime + journalisé');
  await call(admin, `/organization/members/${mQuality.id}/role`, 'PATCH', { role: 'quality' }); // remise en état

  // 6. Révocation : on crée un membre jetable, on le révoque, on vérifie qu'il perd l'accès
  const throwaway = `revoke-e2e-${Date.now()}@nutrichain.local`;
  const ctx = await import('../src/modules/identity/auth.config');
  const hash = await (await ctx.auth.$context).password.hash('NutriChain!2026');
  const u = await prisma.user.create({
    data: { email: throwaway, name: 'Jetable', emailVerified: true },
  });
  await prisma.account.create({
    data: {
      id: `account-${u.id}`,
      accountId: u.id,
      providerId: 'credential',
      userId: u.id,
      password: hash,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const mThrow = await prisma.member.create({
    data: {
      id: `member-${u.id}`,
      organizationId: mOwner.organizationId,
      userId: u.id,
      role: 'viewer',
      createdAt: new Date(),
    },
  });

  const tokenThrow = await connexion(throwaway);
  const avant = await call(tokenThrow, '/organization/alerts');
  if (avant.status !== 200)
    echec(`le membre jetable n'a pas accès AVANT révocation (${avant.status})`);
  ok('Le membre jetable a accès avant révocation');

  const rev = await call(admin, `/organization/members/${mThrow.id}/revoke`, 'POST');
  if (rev.status !== 200) echec(`révocation échouée (${rev.status})`);

  const apres = await call(tokenThrow, '/organization/alerts');
  if (apres.status === 200) echec('⛔ le membre révoqué a ENCORE accès');
  ok(`Accès refusé immédiatement après révocation (${apres.status})`);

  const sessionsRestantes = await prisma.session.count({ where: { userId: u.id } });
  if (sessionsRestantes !== 0) echec(`sessions non supprimées (${sessionsRestantes})`);
  ok('Sessions du révoqué supprimées (vrai kick)');

  const revAudit = await prisma.audit_Log.count({
    where: { action: 'REVOKE_MEMBER', entity_id: mThrow.id },
  });
  if (revAudit !== 1) echec('révocation non journalisée');
  ok('Révocation journalisée');

  // Nettoyage
  await prisma.audit_Log.deleteMany({ where: { entity_id: { in: [mThrow.id, mQuality.id] } } });
  await prisma.account.deleteMany({ where: { userId: u.id } });
  await prisma.user.delete({ where: { id: u.id } });
  ok('Données e2e nettoyées');

  console.log('\n✅ Gestion des membres : rôles, gardes de sécurité, révocation effective.\n');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`);
  await prisma.$disconnect();
  process.exit(1);
});
