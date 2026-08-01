import crypto from 'crypto';

/**
 * Inputs canoniques d'une ligne d'audit, format figé de la signature.
 *
 * IMPORTANT : la forme exacte de cet objet (clés + ordre) constitue le **contrat
 * cryptographique** de la hash chain WORM. Tout changement de la formule invalide
 * rétroactivement la totalité des `signature_hash` déjà persistés en DB.
 *
 * Les tests "golden vector" de `auditHash.util.test.ts` ancrent la formule via des SHA256 hex
 * literals — si la formule bouge, ils pètent bruyamment et l'auteur doit consciemment décider
 * du sort des lignes déjà écrites.
 *
 * ⚠️ Le premier de ces vecteurs ne portait qu'UNE clé : la canonicalisation de #294 l'a laissé
 * vert. Un vecteur aux clés désordonnées, imbriquées et en tableau a été ajouté — c'est lui qui
 * ancre réellement la formule. Ne jamais revenir à un vecteur à clé unique.
 */
export interface AuditHashInputs {
  organizationId: string;
  userId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  prevHash: string;
  timestamp: string;
}

/**
 * Hash WORM canonique d'une ligne d'audit (SHA256 hex).
 *
 * Helper extrait de `audit.service.ts` pour être consommé symétriquement par :
 * - `auditService.logAction` (écriture)
 * - `auditVerifyService.verifyChain` (vérification)
 *
 * Garantit que la formule est UNIQUE — pas de risque de drift entre l'écriture
 * et la vérification après refactor.
 *
 * Sémantique des champs nullables (verrouillée par tests) :
 * - `userId` `undefined`, `null` OU empty string `''` → remplacé par `'system'`.
 *   (le `||` traite tous les falsy comme tels — confirmé par test #7).
 * - `oldValue` / `newValue` `null` → sérialisé `null` dans le JSON.
 * - `oldValue` / `newValue` `undefined` → DROPPÉ par JSON.stringify (hash différent).
 *   `audit.service.ts` normalise `undefined → null` AVANT d'appeler ce helper, pour
 *   éviter une divergence write/verify quand Postgres persiste NULL pour undefined.
 */
/**
 * Réécrit une valeur JSON avec ses clés triées, récursivement.
 *
 * Sans ça, la signature dépendait de l'ordre d'INSERTION de l'objet en mémoire, alors que la
 * vérification travaille sur l'objet relu depuis `jsonb` — qui réordonne les clés (par longueur
 * puis octets, à tous les niveaux). Toute écriture dont les clés n'étaient pas déjà dans cet ordre
 * était donc déclarée falsifiée : 222 maillons sur 257 de la base de développement (#294).
 *
 * Un tableau n'est PAS réordonné : son ordre est une donnée — deux lots inversés ne décrivent pas
 * la même expédition. On descend seulement dans ses éléments, où vivent les objets réels
 * (`lots: [{ id_lot, quantite }]`).
 *
 * L'ordre de tri n'a pas à imiter celui de `jsonb` : il suffit qu'il soit le même à l'écriture et
 * à la vérification, ce qui rend la signature indépendante du stockage.
 *
 * ⚠️ `toJSON()` est appelé AVANT le tri, et ce n'est pas cosmétique. Une `Date` et un
 * `Prisma.Decimal` sont des `object` sans clé énumérable : les reconstruire clé par clé les réduit
 * à `{}`. Les charges d'audit en contiennent (`receipt.service.ts` journalise l'entité entière,
 * avec sa `date_reception`), et la signature aurait alors cessé de couvrir ces champs — deux
 * réceptions à des dates différentes auraient produit le même hash. Constaté en traçant la chaîne
 * réellement hachée par le seed, pas en relisant le code.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const serializable = value as { toJSON?: () => unknown };
  if (typeof serializable.toJSON === 'function') {
    return canonicalize(serializable.toJSON());
  }
  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    sorted[key] = canonicalize(source[key]);
  }
  return sorted;
}

export function computeAuditHash(inputs: AuditHashInputs): string {
  const dataToHash = JSON.stringify({
    organizationId: inputs.organizationId,
    userId: inputs.userId || 'system',
    action: inputs.action,
    entity: inputs.entity,
    entityId: inputs.entityId,
    oldValue: canonicalize(inputs.oldValue),
    newValue: canonicalize(inputs.newValue),
    prevHash: inputs.prevHash,
    timestamp: inputs.timestamp,
  });

  return crypto.createHash('sha256').update(dataToHash).digest('hex');
}

/**
 * Constante exportée pour la valeur "genesis" de `prev_hash` (1ère ligne d'une chain).
 * 64 zéros hex == `crypto.createHash('sha256').digest('hex').length`.
 */
export const GENESIS_PREV_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
