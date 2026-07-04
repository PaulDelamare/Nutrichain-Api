import { Prisma } from '@prisma/client';
import { DEFAULT_GS1_COMPANY_PREFIX } from './gs1.utils';

/**
 * Résout le préfixe entreprise GS1 de l'organisation (repli fictif documenté
 * pour les organisations non configurées). À appeler dans la transaction qui
 * émet les identifiants GS1 (SSCC, URN LGTIN).
 */
export async function resolveGs1Prefix(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<string> {
  const organization = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { gs1_company_prefix: true },
  });
  return organization?.gs1_company_prefix ?? DEFAULT_GS1_COMPANY_PREFIX;
}
