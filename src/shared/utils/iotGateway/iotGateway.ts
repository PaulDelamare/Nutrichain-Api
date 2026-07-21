import { createHash } from 'crypto';
import { prisma } from '../../configs/prismaClient.config';

/**
 * Empreinte d'une clé de passerelle. Stockée en base à la place de la clé : une fuite du dump
 * ne rend pas la clé rejouable, et la recherche reste un accès index (aucune comparaison
 * secret-par-secret à parcourir, donc aucune fuite de temps exploitable).
 */
export const hashGatewayKey = (key: string): string =>
  createHash('sha256').update(key, 'utf8').digest('hex');

/**
 * Résout l'organisation d'une clé de passerelle IoT. `null` si la clé est inconnue ou révoquée —
 * l'appelant doit alors refuser la trame : sans tenant sûr, une mesure atterrirait dans les
 * données d'un autre client (cf. #93).
 */
export const resolveGatewayOrg = async (presentedKey: string): Promise<string | null> => {
  const gateway = await prisma.iotGateway.findFirst({
    where: { key_hash: hashGatewayKey(presentedKey), revoked_at: null },
    select: { organization_id: true },
  });

  return gateway?.organization_id ?? null;
};
