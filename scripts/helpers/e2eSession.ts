import { PrismaClient } from '@prisma/client';
import { auth } from '../../src/modules/identity/auth.config';

/**
 * Ouvre une VRAIE session pour un scénario de bout en bout.
 *
 * Les scripts e2e s'authentifiaient jusqu'ici avec la seule clé API — c'est-à-dire par le chemin
 * qu'aucun client réel n'emprunte, et qui n'existe plus : une clé identifie une application, elle
 * n'autorise personne. Ils validaient donc un parcours imaginaire. Ils empruntent désormais le
 * même chemin que le mobile : connexion, puis jeton porté sur chaque requête.
 *
 * Le mot de passe est haché par Better-Auth lui-même : le hacher à la main produirait un compte
 * que sa propre vérification rejetterait.
 */
export async function signInAsOperator(
  prisma: PrismaClient,
  {
    apiBase,
    apiKey,
    organizationId,
    email = 'e2e-operator@nutrichain.local',
    password = 'NutriChain!2026',
    role = 'operator',
    frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173',
  }: {
    apiBase: string;
    apiKey: string;
    organizationId: string;
    email?: string;
    password?: string;
    role?: string;
    frontendUrl?: string;
  }
): Promise<{ token: string; userId: string }> {
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: 'E2E Opérateur', emailVerified: true },
  });

  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(password);

  await prisma.account.upsert({
    where: { id: `account-${user.id}` },
    update: { password: passwordHash },
    create: {
      id: `account-${user.id}`,
      accountId: user.id,
      providerId: 'credential',
      userId: user.id,
      password: passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  await prisma.member.upsert({
    where: { id: `member-${user.id}-${organizationId}` },
    update: { role },
    create: {
      id: `member-${user.id}-${organizationId}`,
      organizationId,
      userId: user.id,
      role,
      createdAt: new Date(),
    },
  });

  const response = await fetch(`${apiBase}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // La clé API n'est exigée QUE par `/api/auth/*` : elle identifie l'application appelante.
      'x-api-key': apiKey,
      // Better-Auth exige une origine déclarée (protection CSRF) : `fetch` côté Node envoie
      // `Sec-Fetch-Mode` sans `Origin`, et la requête part alors en 403 « Missing or null Origin ».
      Origin: frontendUrl,
    },
    body: JSON.stringify({ email, password }),
  });

  const data = (await response.json()) as { token?: string };

  if (!response.ok || !data.token) {
    throw new Error(`Connexion e2e impossible (${response.status}) : ${JSON.stringify(data)}`);
  }

  return { token: data.token, userId: user.id };
}
