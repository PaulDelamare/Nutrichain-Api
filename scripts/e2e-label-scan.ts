/**
 * E2E — l'étiquette GS1 est imprimable, décodable, et le lien qu'elle porte répond.
 *
 * Le maillon le plus fragile du projet n'était couvert par aucun test : trois défauts s'y sont
 * succédé (#139 lien vers une route non montée, #146 domaine de repli qui ne résout pas, #272 QR
 * étiré donc indécodable), tous invisibles à une suite verte, tous visibles au premier scan réel.
 *
 * Ce scénario reproduit ce scan sans caméra, contre un serveur et une base réels :
 *   1. la route d'étiquette rend un PNG carré, sous session, cloisonné par organisation ;
 *   2. l'image est **décodée optiquement** (jsQR, le décodeur des webcams JS) — si jsQR lit ce
 *      motif, une caméra le lit aussi ;
 *   3. l'URL ainsi extraite de l'image est appelée **telle quelle**, sans être reconstruite : c'est
 *      la seule façon de prouver que ce qui est imprimé mène quelque part.
 *
 * Ce qu'il ne prouve pas : l'optique physique (impression, éclairage, angle, autofocus). Ce
 * dernier pas se fait avec un téléphone, protocole au §7 de docs/27_GS1_EPCIS.md.
 *
 * Pré-requis : serveur lancé (`npm run dev`), Postgres migré + seedé, Mongo up, .env renseigné.
 * Lancement : npm run e2e:label-scan
 */
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { prisma } from '../src/shared/configs/prismaClient.config';
import { MIN_LABEL_PX } from '../src/modules/logistics/shared/services/label.service';
import { signInAsOperator } from './helpers/e2eSession';

const API_URL = process.env.API_URL || process.env.API_BASE || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || '';
const ORG_ID = process.env.API_KEY_ORG_ID || '';

if (!API_KEY || !ORG_ID) {
  console.error('[E2E] API_KEY et API_KEY_ORG_ID requis dans .env');
  process.exit(1);
}

const OTHER_ORG_ID = 'e2e-label-other-org';
const SUPPLIER_ID = '223e4567-e89b-12d3-a456-426614174010';
const PRODUCT_ID = '223e4567-e89b-12d3-a456-426614174011';
const USER_ID = '223e4567-e89b-12d3-a456-426614174013';
const EQUIPMENT_ID = '223e4567-e89b-12d3-a456-426614174014';
const GTIN = '3000000000024';

let sessionToken = '';
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}

/** Décode le QR comme le ferait une caméra : pixels bruts, pas métadonnées du fichier. */
function decodeQr(png: Buffer): string | null {
  const image = PNG.sync.read(png);
  const result = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
  return result?.data ?? null;
}

async function makeBatch(
  suffix: string,
  statut: string,
  organizationId = ORG_ID,
  productId = PRODUCT_ID
) {
  const lotNumber = `E2ELABEL-${suffix}`;
  await prisma.batch.deleteMany({ where: { organization_id: organizationId, lot_number: lotNumber } });
  return prisma.batch.create({
    data: {
      organization_id: organizationId,
      lot_number: lotNumber,
      id_produit: productId,
      quantite_actuelle: 100,
      quantite_base: 100,
      unite_code: 'KG',
      statut,
      created_by: USER_ID,
      date_peremption: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    },
  });
}

async function seed() {
  await prisma.organization.upsert({
    where: { id: OTHER_ORG_ID },
    update: {},
    create: {
      id: OTHER_ORG_ID,
      name: 'E2E Autre Organisation',
      slug: 'e2e-autre-organisation',
      createdAt: new Date(),
    },
  });
  await prisma.unit.upsert({
    where: { code: 'KG' },
    update: {},
    create: { code: 'KG', nom: 'Kilogramme', factor_to_base: 1 },
  });
  await prisma.user.upsert({
    where: { id: USER_ID },
    update: {},
    create: { id: USER_ID, email: 'e2e.label@nutrichain.local', name: 'E2E Label' },
  });
  await prisma.member.upsert({
    where: { id: `member-${USER_ID}-${ORG_ID}` },
    update: { role: 'operator' },
    create: {
      id: `member-${USER_ID}-${ORG_ID}`,
      organizationId: ORG_ID,
      userId: USER_ID,
      role: 'operator',
      createdAt: new Date(),
    },
  });
  await prisma.supplier.upsert({
    where: { id: SUPPLIER_ID },
    update: {},
    create: {
      id: SUPPLIER_ID,
      organization_id: ORG_ID,
      nom_ferme: 'Ferme Etiquette E2E',
      adresse_siege: 'Adresse Test',
    },
  });
  await prisma.product.upsert({
    where: { id: PRODUCT_ID },
    update: { code_gtin: GTIN },
    create: {
      id: PRODUCT_ID,
      organization_id: ORG_ID,
      nom: 'Produit Etiquette E2E',
      categorie: 'Test',
      code_gtin: GTIN,
      duree_conservation_defaut: 365,
      seuil_alerte_stock: 0,
      unite_reference: 'KG',
    },
  });
  // Le produit de l'autre organisation, pour le lot servant au test de cloisonnement.
  await prisma.product.upsert({
    where: { id: `${PRODUCT_ID.slice(0, -1)}9` },
    update: {},
    create: {
      id: `${PRODUCT_ID.slice(0, -1)}9`,
      organization_id: OTHER_ORG_ID,
      nom: 'Produit Autre Org',
      categorie: 'Test',
      code_gtin: '3000000000031',
      duree_conservation_defaut: 365,
      seuil_alerte_stock: 0,
      unite_reference: 'KG',
    },
  });
  await prisma.user.upsert({
    where: { id: `${USER_ID.slice(0, -1)}9` },
    update: {},
    create: {
      id: `${USER_ID.slice(0, -1)}9`,
      email: 'e2e.label.other@nutrichain.local',
      name: 'E2E Label Autre',
    },
  });
}

async function labelRequest(batchId: string, token = sessionToken) {
  return fetch(`${API_URL}/api/logistics/batches/${batchId}/label`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function main() {
  console.log('\n[E2E] Étiquette GS1 — génération, décodage optique, résolution du scan\n');
  await seed();

  const session = await signInAsOperator(prisma, {
    apiBase: API_URL,
    apiKey: API_KEY,
    organizationId: ORG_ID,
  });
  sessionToken = session.token;

  // ---- 1. La route rend une étiquette réellement imprimable ----
  console.log('[1] Génération de l\'étiquette (GET /api/logistics/batches/:id/label)');
  const shipped = await makeBatch('SHIPPED', 'EXPEDIE');
  const response = await labelRequest(shipped.id);
  const png = Buffer.from(await response.arrayBuffer());

  assert(response.status === 200, 'lot expédié → 200');
  assert(
    (response.headers.get('content-type') ?? '').includes('image/png'),
    'Content-Type image/png (réponse binaire, hors enveloppe JSON)'
  );
  assert(
    png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'le corps est un vrai PNG'
  );
  // Sous 180 px de côté, l'étiquette cesse d'être décodable dès qu'une photo y ajoute un angle,
  // du flou ou de la compression (#279). Mesuré ici sur la réponse HTTP réelle.
  assert(
    png.readUInt32BE(16) >= MIN_LABEL_PX,
    `étiquette d'au moins ${MIN_LABEL_PX} px de côté (reçu : ${png.readUInt32BE(16)} px)`
  );

  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert(width === height && width > 0, `image carrée (${width}x${height}) — cf. #272`);

  // ---- 2. Le décodage optique : ce qu'une caméra lirait ----
  console.log('\n[2] Décodage optique du motif (jsQR, décodeur des webcams JS)');
  const decoded = decodeQr(png);
  assert(decoded !== null, 'le motif est DÉCODABLE — une caméra y arriverait aussi');
  assert(
    decoded === `${API_URL}/api/gs1/01/${GTIN}/10/${shipped.lot_number}`,
    `le contenu décodé est le Digital Link attendu (${decoded})`
  );

  // ---- 3. L'URL lue dans l'image est appelée TELLE QUELLE ----
  // Reconstruire l'URL à la main testerait notre idée de l'étiquette, pas l'étiquette. C'est
  // précisément ce qui a laissé passer #139 et #146.
  console.log('\n[3] Résolution du lien extrait de l\'image (le scan proprement dit)');
  const scan = await fetch(decoded ?? '');
  const scanBody = (await scan.json()) as {
    data?: { lot?: Record<string, unknown>; trace?: { origines?: { ferme: string }[] } };
  };

  assert(scan.status === 200, 'le lien imprimé RÉPOND (pas de 404 : #139, pas de NXDOMAIN : #146)');
  assert(
    scanBody.data?.lot?.numero_lot === shipped.lot_number,
    'la réponse porte bien le lot scanné'
  );
  assert(scanBody.data?.lot?.gtin === GTIN, 'la réponse porte bien le GTIN scanné');
  assert(
    scanBody.data?.lot?.statut_sanitaire === 'CONFORME',
    'lot expédié sain → statut_sanitaire CONFORME'
  );

  // Le canal est public : rien de plus que le nécessaire ne doit en sortir (arbitrage DPIA).
  const rawBody = JSON.stringify(scanBody);
  assert(!rawBody.includes(SUPPLIER_ID), 'aucun identifiant fournisseur exposé au public');
  assert(!rawBody.includes('adresse_siege'), 'aucune adresse de siège exposée au public');

  // ---- 4. Un lot sous rappel doit alerter le consommateur ----
  console.log('\n[4] Lot sous rappel — le canal public existe pour ça');
  const recalled = await makeBatch('RECALL', 'ALERTE');
  const recalledScan = await fetch(
    `${API_URL}/api/gs1/01/${GTIN}/10/${recalled.lot_number}`
  );
  const recalledBody = (await recalledScan.json()) as {
    data?: { lot?: { statut_sanitaire?: string } };
  };
  assert(recalledScan.status === 200, 'lot en ALERTE → 200 (il doit rester scannable)');
  assert(
    recalledBody.data?.lot?.statut_sanitaire === 'RAPPEL_CONSOMMATEUR',
    'lot en ALERTE → statut_sanitaire RAPPEL_CONSOMMATEUR'
  );

  // ---- 5. Les cas limites du scan ----
  console.log('\n[5] Cas limites du scan public');
  const lowercase = await fetch(
    `${API_URL}/api/gs1/01/${GTIN}/10/${shipped.lot_number.toLowerCase()}`
  );
  assert(lowercase.status === 200, 'lot saisi en minuscules → 200 (la casse est normalisée)');

  const inStock = await makeBatch('INSTOCK', 'EN_STOCK');
  const notShipped = await fetch(`${API_URL}/api/gs1/01/${GTIN}/10/${inStock.lot_number}`);
  assert(
    notShipped.status === 404,
    'lot encore en usine (EN_STOCK) → 404 (le B2C ne voit que ce qui est commercialisé)'
  );

  const unknown = await fetch(`${API_URL}/api/gs1/01/${GTIN}/10/E2ELABEL-INEXISTANT`);
  assert(unknown.status === 404, 'lot inconnu → 404');

  const badGtin = await fetch(`${API_URL}/api/gs1/01/pas-un-gtin/10/${shipped.lot_number}`);
  assert(badGtin.status === 400 || badGtin.status === 404, 'GTIN malformé → rejeté (400/404)');

  // ---- 6. L'étiquette est une ressource privée : session et cloisonnement ----
  console.log('\n[6] Contrôle d\'accès de la route d\'étiquette');
  const anonymous = await labelRequest(shipped.id, '');
  assert(anonymous.status === 401, 'sans session → 401');

  const otherOrgBatch = await makeBatch(
    'OTHERORG',
    'EXPEDIE',
    OTHER_ORG_ID,
    `${PRODUCT_ID.slice(0, -1)}9`
  );
  const crossTenant = await labelRequest(otherOrgBatch.id);
  assert(
    crossTenant.status === 404,
    'lot d\'une AUTRE organisation → 404 (cloisonnement, anti-énumération)'
  );

  // Le 400 « produit sans GTIN » a été RETIRÉ de cette route (#276) : `Product.code_gtin` est NON
  // NULL en base, la branche n'était atteignable par aucun chemin et le Swagger promettait un
  // comportement que rien ne pouvait produire.

  // L'étiquette est authentifiée et cloisonnée : aucun cache PARTAGÉ ne doit la conserver (#278).
  // `public` est la seule directive qui autorise un proxy à garder une réponse portant un en-tête
  // d'autorisation — vérifié ici sur la vraie réponse HTTP, pas sur un mock.
  const cacheHeader = response.headers.get('cache-control') ?? '';
  assert(cacheHeader.includes('private'), `étiquette servie en cache privé (reçu : ${cacheHeader})`);
  assert(!cacheHeader.includes('public'), 'aucun cache partagé autorisé sur une ressource cloisonnée');

  // ---- 7. Le scan MÉTIER : l'opérateur scanne l'étiquette d'un lot en réception/transformation ----
  // Le parcours réel n'est pas « je connais le numéro de lot » : c'est « la caméra a lu ce QR ».
  // On repart donc du contenu DÉCODÉ à l'étape 2, on en extrait le lot comme le fait le mobile
  // (`src/lib/gs1.ts`), et on appelle la route de résolution avec ce qu'on en a tiré.
  console.log('\n[7] Scan métier — du QR décodé à la résolution du lot (réception, transformation, expédition)');
  const segments = (decoded ?? '').split('/');
  const lotScanne = segments[segments.length - 1];
  const gtinScanne = segments[segments.length - 3];

  assert(lotScanne === shipped.lot_number, 'le numéro de lot extrait du QR est le bon');
  assert(gtinScanne === GTIN, 'le GTIN extrait du QR est le bon');

  const resolution = await fetch(
    `${API_URL}/api/logistics/batches/resolve?lot_number=${encodeURIComponent(lotScanne)}`,
    { headers: { Authorization: `Bearer ${sessionToken}` } }
  );
  const resolutionBody = (await resolution.json()) as { data?: { id?: string } };
  assert(resolution.status === 200, 'lot scanné → résolu par l\'opérateur (200)');
  assert(resolutionBody.data?.id === shipped.id, 'la résolution rend bien le lot scanné');

  const resolutionAnonyme = await fetch(
    `${API_URL}/api/logistics/batches/resolve?lot_number=${encodeURIComponent(lotScanne)}`
  );
  assert(resolutionAnonyme.status === 401, 'résolution sans session → 401');

  // ---- 8. L'étiquette du MATÉRIEL (cuve, chambre froide) ----
  // Même service de rendu que l'étiquette de lot : elle portait donc le même défaut (#277), et
  // aucun test ne la couvrait non plus. Ce QR encode un code brut, pas une URL.
  console.log('\n[8] Étiquette matériel — le second usage du même service de rendu');
  const location = await prisma.location.findFirst({ where: { organization_id: ORG_ID } });
  if (!location) {
    console.log('  ⚠️ aucun lieu dans l\'organisation : étape ignorée (lancer `npm run seed:demo`)');
  } else {
    const equipment = await prisma.equipment.upsert({
      where: { id: EQUIPMENT_ID },
      update: {},
      create: {
        id: EQUIPMENT_ID,
        organization_id: ORG_ID,
        nom: 'Cuve E2E Etiquette',
        type: 'CUVE',
        id_lieu: location.id,
        qr_code_id: 'EQ-E2E-LABEL-001',
      },
    });

    const equipLabel = await fetch(`${API_URL}/api/organization/equipment/${equipment.id}/label`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const equipPng = Buffer.from(await equipLabel.arrayBuffer());

    assert(equipLabel.status === 200, 'étiquette matériel → 200');
    assert(
      equipPng.readUInt32BE(16) === equipPng.readUInt32BE(20),
      `étiquette matériel carrée (${equipPng.readUInt32BE(16)}x${equipPng.readUInt32BE(20)})`
    );
    const equipDecoded = decodeQr(equipPng);
    assert(equipDecoded !== null, 'étiquette matériel DÉCODABLE');
    assert(
      equipDecoded === equipment.qr_code_id,
      `le QR matériel porte son code de rattachement (${equipDecoded})`
    );

    const equipAnonyme = await fetch(
      `${API_URL}/api/organization/equipment/${equipment.id}/label`
    );
    assert(equipAnonyme.status === 401, 'étiquette matériel sans session → 401');
  }

  // ---- 9. Le canal public historique (lot seul) ----
  console.log('\n[9] Scan public par numéro de lot seul (canal historique)');
  const legacy = await fetch(`${API_URL}/api/public/scan/${shipped.lot_number}`);
  assert(legacy.status === 200, 'lot expédié résolu par son seul numéro → 200');

  console.log(`\n[E2E] ${passed} vérifications passées, ${failed} échouées.\n`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((error) => {
    console.error('\n[E2E] Échec :', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
