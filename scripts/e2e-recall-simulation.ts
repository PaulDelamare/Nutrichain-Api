/**
 * E2E — simuler un rappel par HTTP réel, et prouver que la simulation ne ment pas.
 *
 * L'écran de simulation annonce « Lecture seule ». Voir les magasins touchés exigeait pourtant de
 * déclencher un rappel RÉEL, donc irréversible (#79 côté front). L'endpoint de simulation ferme ce
 * trou, et il n'a de valeur que s'il annonce EXACTEMENT ce que le rappel bloquera : une simulation
 * qui rend un autre chiffre est pire que pas de simulation.
 *
 * Ce scénario est le seul à prouver la chaîne complète — session, rôle, validation, cloisonnement,
 * en-têtes, puis équivalence avec le rappel réel joué juste après sur les MÊMES lots. Les tests
 * unitaires mockent le SQL, et le test d'intégration appelle le service sans passer par HTTP.
 *
 * Pré-requis : PostgreSQL, MongoDB, migrations, seed, et **serveur en marche**.
 */
import { prisma } from '../src/shared/configs/prismaClient.config';
import { signInAsOperator } from './helpers/e2eSession';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const API_KEY = process.env.API_KEY ?? '';
const ORG_ID = process.env.API_KEY_ORG_ID;

const failures: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}`);
    failures.push(label);
  }
}

const call = (path: string, token: string, method = 'GET', body?: unknown) =>
  fetch(`${API_URL}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

interface SimulatedShipment {
  shipmentRef: string;
  customerName: string;
  batchIds: string[];
}

interface Simulation {
  impactedCount: number;
  impactedBatchIds: string[];
  affectedShipments: SimulatedShipment[];
  affectedShipmentsCount: number;
}

async function main(): Promise<void> {
  if (!ORG_ID) throw new Error('API_KEY_ORG_ID manquant dans .env');

  const stamp = Date.now().toString().slice(-9);
  const unit = await prisma.unit.findFirstOrThrow();
  const product = await prisma.product.findFirstOrThrow({ where: { organization_id: ORG_ID } });
  const equipment = await prisma.equipment.findFirstOrThrow({ where: { organization_id: ORG_ID } });

  // Le rôle le plus faible : c'est lui qui doit pouvoir simuler. L'aligner sur les rôles qualité,
  // comme le rappel réel, fermerait l'écran à la moitié des comptes sans rien protéger — la même
  // donnée sort déjà de `GET /organization/shipments`, ouvert à tous les rôles.
  const viewer = await signInAsOperator(prisma, {
    apiBase: API_URL,
    apiKey: API_KEY,
    organizationId: ORG_ID,
    email: 'e2e-viewer-simulation@nutrichain.local',
    role: 'viewer',
  });

  const quality = await signInAsOperator(prisma, {
    apiBase: API_URL,
    apiKey: API_KEY,
    organizationId: ORG_ID,
    email: 'e2e-quality-simulation@nutrichain.local',
    role: 'quality',
  });

  console.log('\n[E2E] Fixtures : source → enfant → petit-enfant, dont un lot déjà bloqué.');

  const makeBatch = async (suffix: string, statut = 'EN_STOCK') =>
    prisma.batch.create({
      data: {
        organization_id: ORG_ID,
        lot_number: `E2E-SIM-${stamp}-${suffix}`,
        id_produit: product.id,
        unite_code: unit.code,
        quantite_actuelle: 10,
        quantite_base: 10,
        statut,
        created_by: viewer.userId,
      },
      select: { id: true },
    });

  const source = await makeBatch('SRC');
  const child = await makeBatch('CHILD');
  // Déjà en quarantaine : le rappel réel n'a AUCUN filtre de statut et le bloque quand même. Une
  // simulation qui l'écarterait sous-estimerait l'impact au moment d'une décision sanitaire.
  const blocked = await makeBatch('BLOQUE', 'BLOQUE');

  const link = async (parentId: string, childId: string) => {
    const transformation = await prisma.transformation.create({
      data: {
        id_lot_enfant: childId,
        id_produit_fini: product.id,
        id_user: viewer.userId,
        id_materiel: equipment.id,
        statut: 'TERMINE',
      },
      select: { id: true },
    });
    await prisma.transformationComposition.create({
      data: {
        id_transformation: transformation.id,
        id_lot_parent: parentId,
        quantite_prelevee: 5,
        unite: unit.code,
        lot_parent_epuise: false,
      },
    });
  };

  await link(source.id, child.id);
  await link(child.id, blocked.id);

  const customer = await prisma.customer.create({
    data: {
      organization_id: ORG_ID,
      nom_enseigne: `Magasin E2E ${stamp}`,
      contact_urgence: '+33600000000',
      email: `magasin-${stamp}@example.test`,
      adresse_livraison: '12 rue de la Preuve',
    },
    select: { id: true, nom_enseigne: true },
  });

  const shipmentRef = `E2E-SIM-SHIP-${stamp}`;
  const shipment = await prisma.shipment.create({
    data: {
      organization_id: ORG_ID,
      id_client: customer.id,
      shipment_id: shipmentRef,
      date_envoi: new Date(),
      transporteur: 'TransFroid E2E',
      statut_livraison: 'EN_ROUTE',
      created_by: viewer.userId,
    },
    select: { id: true },
  });

  await prisma.liaison_Shipment.create({
    data: {
      id_expedition: shipment.id,
      id_lot: child.id,
      quantite_expediee: 5,
      unite: unit.code,
    },
  });

  try {
    console.log('\n[E2E] 1. La simulation, au rôle le plus faible.');

    const response = await call(`/traceability/batches/${source.id}/recall-simulation`, viewer.token);
    const payload = (await response.json()) as { data: Simulation };
    const simulation = payload.data;

    assert(response.status === 200, 'un viewer obtient 200 sur la simulation');
    assert(
      response.headers.get('cache-control') === 'no-store',
      'la réponse interdit toute mise en cache intermédiaire'
    );
    assert(simulation.impactedCount === 3, 'le compte inclut le lot source et sa descendance (3)');
    assert(
      simulation.impactedBatchIds.includes(blocked.id),
      'un lot déjà en quarantaine est compté, comme le fera le rappel'
    );
    assert(
      JSON.stringify(simulation.impactedBatchIds) ===
        JSON.stringify([...simulation.impactedBatchIds].sort()),
      'la liste des lots est rendue dans un ordre déterministe'
    );
    assert(simulation.affectedShipmentsCount === 1, 'une expédition est identifiée');
    assert(
      simulation.affectedShipments[0]?.customerName === customer.nom_enseigne,
      'le magasin touché est NOMMÉ, pas seulement compté'
    );

    const shipmentKeys = Object.keys(simulation.affectedShipments[0] ?? {}).sort();
    assert(
      JSON.stringify(shipmentKeys) ===
        JSON.stringify([
          'batchIds',
          'customerName',
          'dateEnvoi',
          'dateLivraison',
          'shipmentId',
          'shipmentRef',
          'statutLivraison',
          'transporteur',
        ]),
      "aucune coordonnée client ne sort par ce chemin (jeu de clés exact) : " + shipmentKeys.join(',')
    );

    console.log('\n[E2E] 2. Ce que la simulation doit refuser.');

    const anonymous = await fetch(
      `${API_URL}/api/traceability/batches/${source.id}/recall-simulation`,
      { headers: { 'x-api-key': API_KEY } }
    );
    assert(anonymous.status === 401, 'sans session : 401');

    const malformed = await call('/traceability/batches/pas-un-uuid/recall-simulation', viewer.token);
    assert(malformed.status === 400, 'identifiant hors format : 400');

    const unknown = await call(
      '/traceability/batches/11111111-1111-4111-8111-111111111111/recall-simulation',
      viewer.token
    );
    assert(unknown.status === 404, 'lot inconnu : 404, comme le rappel réel');

    console.log('\n[E2E] 3. Le rappel RÉEL, sur les mêmes lots : les deux doivent coïncider.');

    const recallResponse = await call(
      `/traceability/batches/${source.id}/recall`,
      quality.token,
      'POST',
      { reason: 'Comparaison simulation / rappel reel (e2e)' }
    );
    const recallPayload = (await recallResponse.json()) as {
      data: { blockedBatchesCount: number; impactedBatchIds: string[]; affectedShipments: SimulatedShipment[] };
    };
    const real = recallPayload.data;

    assert(recallResponse.status === 200, 'le rappel réel aboutit');
    assert(
      simulation.impactedCount === real.blockedBatchesCount,
      `le nombre de lots annoncé (${simulation.impactedCount}) est celui bloqué (${real.blockedBatchesCount})`
    );
    assert(
      JSON.stringify(simulation.impactedBatchIds) === JSON.stringify(real.impactedBatchIds),
      'les DEUX ensembles de lots sont identiques, dans le même ordre'
    );
    assert(
      JSON.stringify(simulation.affectedShipments.map((s) => s.shipmentRef)) ===
        JSON.stringify(real.affectedShipments.map((s) => s.shipmentRef)),
      'les mêmes expéditions, dans le même ordre'
    );
    assert(
      JSON.stringify(simulation.affectedShipments[0]?.batchIds) ===
        JSON.stringify(real.affectedShipments[0]?.batchIds),
      'les mêmes lots par expédition'
    );

    console.log('\n[E2E] 4. Et la simulation, elle, n’avait rien écrit.');

    // Relu APRÈS le rappel : ces lots sont maintenant en ALERTE, donc l'assertion ne peut pas être
    // vraie par accident. Ce qui la rend probante, c'est l'ordre — la simulation a tourné avant.
    const afterRecall = await prisma.batch.findMany({
      where: { id: { in: [source.id, child.id, blocked.id] } },
      select: { statut: true },
    });
    assert(
      afterRecall.every((b) => b.statut === 'ALERTE'),
      'seul le rappel a changé les statuts — la simulation les avait laissés intacts'
    );
  } finally {
    console.log('\n[E2E] Nettoyage des fixtures.');
    await prisma.liaison_Shipment.deleteMany({ where: { id_expedition: shipment.id } });
    await prisma.batch_Mouvement.deleteMany({
      where: { id_lot: { in: [source.id, child.id, blocked.id] } },
    });
    await prisma.shipment.deleteMany({ where: { id: shipment.id } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
    await prisma.transformationComposition.deleteMany({
      where: { id_lot_parent: { in: [source.id, child.id] } },
    });
    await prisma.transformation.deleteMany({
      where: { id_lot_enfant: { in: [child.id, blocked.id] } },
    });
    await prisma.batch.deleteMany({ where: { id: { in: [source.id, child.id, blocked.id] } } });
    // L'alerte de rappel créée par le scénario. Les maillons d'audit, eux, RESTENT : les retirer
    // romprait le chaînage de l'organisation de démonstration (#291).
    await prisma.alert.deleteMany({ where: { related_id: source.id } });
  }

  if (failures.length > 0) {
    console.error(`\n[E2E] ÉCHEC — ${failures.length} vérification(s) :`);
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }

  console.log('\n[E2E] Toutes les vérifications passent.');
}

main()
  .catch((error) => {
    console.error('[E2E] Erreur :', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
