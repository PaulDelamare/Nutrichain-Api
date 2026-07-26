import { createHash } from 'crypto';

/**
 * Dérive une clé de verrou consultatif PostgreSQL (`bigint` signé positif) à partir d'un ou
 * plusieurs identifiants.
 *
 * Les verrous consultatifs partagent un espace de clés unique pour toute la base : deux
 * fonctionnalités sans rapport qui tomberaient sur la même clé se bloqueraient mutuellement sans
 * qu'aucune trace ne l'explique. Un SHA-256 des identifiants, préfixés par un espace de noms,
 * rend la collision négligeable et la clé reproductible d'une instance à l'autre — indispensable
 * puisque c'est précisément ce qui exclut les répliques entre elles.
 *
 * Les 63 bits utiles : bit de signe effacé sur les 4 octets de poids fort, car `pg_*_advisory_*`
 * prend un `bigint` SIGNÉ et une clé négative serait tout aussi valide mais illisible dans
 * `pg_locks` (où elle se lit en deux moitiés `classid`/`objid`).
 *
 * Extrait d'`iotAlert.service.ts`, où la dérivation était privée : le job de vérification d'audit
 * en a besoin à l'identique (#238), et une troisième copie divergerait tôt ou tard.
 */
export function advisoryLockKey(...parts: string[]): bigint {
  const digest = createHash('sha256').update(parts.join(':')).digest();
  const high = BigInt(digest.readUInt32BE(0)) & 0x7fffffffn; // clear sign bit
  const low = BigInt(digest.readUInt32BE(4));
  return (high << 32n) | low;
}
