import { randomBytes, randomUUID } from 'crypto';
import { prisma } from '../src/shared/configs/prismaClient.config';

/**
 * NUTRICHAIN — Preuve, contre l'API RÉELLE, qu'une inscription enrôle l'utilisateur dans
 * l'organisation de SON jeton, et d'aucune autre (issue #95).
 *
 * Le défaut : le middleware d'inscription validait bien le couple (jeton, e-mail), mais le hook qui
 * enrôle réellement re-cherchait l'invitation **par e-mail seul**, sans `ORDER BY`. Avec deux
 * invitations en attente pour la même adresse, Postgres en rendait une arbitrairement : la victime
 * cliquait le lien de son employeur et atterrissait chez quelqu'un d'autre, avec le rôle défini par
 * ce quelqu'un d'autre. Un administrateur pouvait donc détourner l'accueil d'un utilisateur invité
 * ailleurs, puis lire ce que la victime y saisissait en croyant être chez elle.
 *
 * L'invitation pirate est créée EN PREMIER : c'est l'ordre le plus défavorable, celui où l'ancien
 * code la retenait.
 *
 * Prérequis : `npm run dev` sur une base seedée (`npm run seed`).
 * Lancement : npm run e2e:invitation
 */

const API_URL = process.env.API_URL || process.env.API_BASE || 'http://localhost:3000';
const API_KEY = process.env.API_KEY;
const ORG_LEGITIME = process.env.API_KEY_ORG_ID;
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

if (!API_KEY || !ORG_LEGITIME) {
  console.error('[E2E] API_KEY et API_KEY_ORG_ID requis dans .env');
  process.exit(1);
}

const ok = (msg: string) => console.log(`  ✅ ${msg}`);
const fail = (msg: string): never => {
  throw new Error(msg);
};

const suffixe = randomBytes(4).toString('hex');
const EMAIL = `e2e-invite-${suffixe}@nutrichain.local`;
const MOT_DE_PASSE = 'NutriChain!2026';
const ORG_PIRATE = `e2e-pirate-${suffixe}`;

async function creerInvitation(organizationId: string, role: string, inviterId: string) {
  return prisma.invitation.create({
    data: {
      id: randomUUID(),
      organizationId,
      email: EMAIL,
      role,
      status: 'pending',
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      inviterId,
    },
  });
}

async function main() {
  console.log("\n✉️  L'inscription enrôle dans l'organisation du jeton, et d'aucune autre\n");

  const inviteur = await prisma.user.findFirst({
    where: { email: 'admin@nutrichain.local' },
    select: { id: true },
  });
  if (!inviteur) {
    fail('Compte propriétaire introuvable : lance `npm run seed` avant cette preuve.');
  }

  await prisma.organization.create({
    data: { id: ORG_PIRATE, name: ORG_PIRATE, slug: ORG_PIRATE, createdAt: new Date() },
  });

  // L'ordre compte : l'invitation pirate est posée d'abord, c'est celle que l'ancien code retenait.
  const pirate = await creerInvitation(ORG_PIRATE, 'admin', inviteur.id);
  const legitime = await creerInvitation(ORG_LEGITIME!, 'operator', inviteur.id);

  try {
    const res = await fetch(`${API_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY!,
        Origin: FRONTEND_URL,
      },
      body: JSON.stringify({
        email: EMAIL,
        password: MOT_DE_PASSE,
        name: 'Invité E2E',
        token: legitime.id,
      }),
    });

    if (res.status >= 400) {
      fail(`Inscription avec un jeton valide : attendu un succès, reçu ${res.status}`);
    }
    ok('Inscription acceptée avec le jeton de son organisation');

    const utilisateur = await prisma.user.findUnique({
      where: { email: EMAIL },
      select: { id: true },
    });
    if (!utilisateur) {
      fail('Utilisateur non créé.');
    }

    const membre = await prisma.member.findFirst({
      where: { userId: utilisateur.id },
      select: { organizationId: true, role: true },
    });
    if (!membre) {
      fail("Aucun rattachement créé : l'utilisateur n'appartient à aucune organisation.");
    }

    if (membre.organizationId === ORG_PIRATE) {
      fail(
        `DÉTOURNEMENT : l'utilisateur a été enrôlé dans l'organisation pirate (${ORG_PIRATE}) avec le rôle ${membre.role}, alors que son jeton désignait ${ORG_LEGITIME}`
      );
    }
    if (membre.organizationId !== ORG_LEGITIME) {
      fail(`Organisation inattendue : ${membre.organizationId}`);
    }
    ok(`Rattaché à l'organisation de son jeton (${ORG_LEGITIME}), pas à l'organisation pirate`);

    if (membre.role !== 'operator') {
      fail(`Rôle inattendu : ${membre.role} — attendu operator, celui de l'invitation légitime`);
    }
    ok("Rôle repris de l'invitation légitime (operator), pas de l'invitation pirate (admin)");

    const pirateApres = await prisma.invitation.findUnique({
      where: { id: pirate.id },
      select: { status: true },
    });
    if (pirateApres?.status !== 'pending') {
      fail(`L'invitation pirate a été consommée (statut ${pirateApres?.status}) — elle ne devait pas l'être`);
    }
    ok("L'invitation pirate reste en attente : elle n'a pas été consommée au passage");

    console.log("\n🎉 Le jeton décide de l'organisation. Une invitation concurrente ne détourne rien.\n");
  } finally {
    const u = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
    if (u) {
      await prisma.member.deleteMany({ where: { userId: u.id } });
      await prisma.session.deleteMany({ where: { userId: u.id } });
      await prisma.account.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
    await prisma.invitation.deleteMany({ where: { email: EMAIL } });
    await prisma.audit_Log.deleteMany({ where: { organization_id: ORG_PIRATE } });
    await prisma.audit_Checkpoint.deleteMany({ where: { organization_id: ORG_PIRATE } });
    await prisma.organization.deleteMany({ where: { id: ORG_PIRATE } });
  }
}

main()
  .catch((e) => {
    console.error(`\n❌ ${e instanceof Error ? e.message : e}\n`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
