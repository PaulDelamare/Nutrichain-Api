/**
 * E2E — constater une arrivée, par HTTP réel, et prouver que le RAPPEL cesse de mentir.
 *
 * Le défaut d'origine (#283) n'est pas cosmétique : `recall.service` lit `statut_livraison` et le
 * remonte au décideur. Tant que rien ne l'écrivait, toute expédition s'affichait « en route », y
 * compris livrée depuis trois semaines — au moment précis où l'on choisit entre intercepter un
 * camion et rappeler en rayon.
 *
 * Ce scénario construit donc l'expédition **par l'API** (donc `EN_ROUTE`), appelle la confirmation,
 * puis déclenche un rappel et exige que l'impact dise la vérité. Le scénario `e2e:recall` existant
 * ne peut pas le prouver : il crée son expédition en Prisma brut avec `statut_livraison: 'LIVRE'`
 * écrit en dur, donc son assertion passerait déjà sans la fonctionnalité.
 *
 * Pré-requis : PostgreSQL, MongoDB, migrations, seed, et **serveur en marche**.
 */
import { prisma } from '../src/shared/configs/prismaClient.config';
import { signInAsOperator } from './helpers/e2eSession';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const API_KEY = process.env.API_KEY ?? '';
const ORG_ID = process.env.API_KEY_ORG_ID;

const failures: string[] = [];
let token = '';

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}`);
    failures.push(label);
  }
}

const call = (path: string, method = 'GET', body?: unknown) =>
  fetch(`${API_URL}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

async function main(): Promise<void> {
  if (!ORG_ID) throw new Error('API_KEY_ORG_ID manquant dans .env');

  const stamp = Date.now().toString().slice(-9);
  const unit = await prisma.unit.findFirstOrThrow();
  const product = await prisma.product.findFirstOrThrow({ where: { organization_id: ORG_ID } });
  const client = await prisma.customer.findFirstOrThrow({
    where: { organization_id: ORG_ID, is_active: true },
  });

  const session = await signInAsOperator(prisma, {
    apiBase: API_URL,
    apiKey: API_KEY,
    organizationId: ORG_ID,
  });
  token = session.token;

  // Declencher un rappel exige QUALITY_ROLES : l'operateur qui confirme une livraison ne peut pas
  // le faire, et c'est voulu. Deux sessions, deux roles, chacune sur son adresse dediee.
  const qualite = await signInAsOperator(prisma, {
    apiBase: API_URL,
    apiKey: API_KEY,
    organizationId: ORG_ID,
    email: 'e2e-quality-livraison@nutrichain.local',
    role: 'quality',
  });
  const rappeler = (lotId: string, reason: string) =>
    fetch(`${API_URL}/api/traceability/batches/${lotId}/recall`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${qualite.token}`,
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify({ reason }),
    });

  const lot = await prisma.batch.create({
    data: {
      organization_id: ORG_ID,
      id_produit: product.id,
      lot_number: `E2E-LIV-${stamp}`,
      quantite_actuelle: 100,
      quantite_base: 100,
      unite_code: unit.code,
      statut: 'EN_STOCK',
      created_by: session.userId,
    },
  });

  let shipmentId = '';

  try {
    console.log('\n[1] Expédier — par HTTP, donc réellement EN_ROUTE');
    const bon = await call('/logistics/shipments', 'POST', {
      id_client: client.id,
      shipment_id: `E2E-LIV-${stamp}`,
      transporteur: 'E2E Transport',
      destination_adresse: '2 rue de la Livraison, 75002 Paris',
      lots: [{ id_lot: lot.id, quantite_expediee: 40 }],
    });
    const bonBody = (await bon.json()) as { data?: { shipment?: { id: string } } };
    shipmentId = bonBody.data?.shipment?.id ?? '';
    assert(bon.status === 201, `POST /logistics/shipments → 201 (reçu ${bon.status})`);

    const avant = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    assert(avant.statut_livraison === 'EN_ROUTE', 'elle naît EN_ROUTE');
    assert(avant.date_livraison === null, 'sans date de livraison');

    console.log('\n[2] Le rappel, AVANT confirmation, annonce une marchandise en transit');
    const rappelAvant = await rappeler(lot.id, 'E2E - verification de l information de livraison');
    const impactAvant = (await rappelAvant.json()) as {
      data?: { affectedShipments?: { statutLivraison: string; dateLivraison: string | null }[] };
    };
    assert(rappelAvant.status === 200 || rappelAvant.status === 201, `rappel → 2xx (reçu ${rappelAvant.status})`);
    const ligneAvant = impactAvant.data?.affectedShipments?.find(() => true);
    assert(ligneAvant?.statutLivraison === 'EN_ROUTE', 'l’impact dit EN_ROUTE — c’est vrai à cet instant');
    assert(ligneAvant?.dateLivraison === null, 'et ne prétend aucune date');

    console.log('\n[3] Les bornes de la date, sur une expédition ENCORE en route');
    // Seul moment où elles sont atteignables : une fois livrée, le retour idempotent court-circuite
    // tout. Sans cette étape, le chemin d'entrée de la date n'était prouvé par rien.
    const avantDepart = await call(`/logistics/shipments/${shipmentId}/delivered`, 'POST', {
      date_livraison: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const avantDepartCorps = await avantDepart.text();
    assert(avantDepart.status === 400, `arrivée antérieure au départ → 400 (reçu ${avantDepart.status})`);
    assert(avantDepartCorps.includes('précède'), 'et le refus dit pourquoi');

    const dansLeFutur = await call(`/logistics/shipments/${shipmentId}/delivered`, 'POST', {
      date_livraison: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
    assert(dansLeFutur.status === 400, `arrivée dans le futur → 400 (reçu ${dansLeFutur.status})`);

    const toujoursEnRoute = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    assert(
      toujoursEnRoute.statut_livraison === 'EN_ROUTE',
      'aucun de ces refus n’a modifié l’expédition'
    );

    console.log('\n[4] Constater l’arrivée');
    const confirme = await call(`/logistics/shipments/${shipmentId}/delivered`, 'POST', {});
    const confirmeBody = (await confirme.json()) as {
      data?: { statut_livraison: string; date_livraison: string; lots_livres: number };
    };
    assert(confirme.status === 200, `POST .../delivered → 200 (reçu ${confirme.status})`);
    assert(confirmeBody.data?.statut_livraison === 'LIVRE', 'la réponse annonce LIVRE');
    assert(confirmeBody.data?.lots_livres === 1, 'et le nombre de lots concernés');

    console.log('\n[5] En base : la date, l’auteur, et le mouvement du lot');
    const apres = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    assert(apres.statut_livraison === 'LIVRE', 'le statut est LIVRE en base');
    assert(apres.date_livraison !== null, 'la date est renseignée');
    assert(apres.delivered_by === session.userId, 'l’auteur est celui de la session');

    const mouvement = await prisma.batch_Mouvement.findFirst({
      where: { id_lot: lot.id, type_action: 'LIVRAISON' },
    });
    assert(mouvement !== null, 'la frise du lot porte un mouvement LIVRAISON');
    assert(mouvement?.id_expedition === shipmentId, 'rattaché à la bonne expédition');

    const maillon = await prisma.audit_Log.findFirst({
      where: { organization_id: ORG_ID, action: 'CONFIRM_SHIPMENT_DELIVERY', entity_id: shipmentId },
    });
    assert(maillon !== null, 'le geste est scellé dans le journal WORM');

    console.log('\n[6] LE DÉFAUT D’ORIGINE — le rappel dit désormais la vérité');
    const rappelApres = await rappeler(lot.id, 'E2E - apres confirmation de livraison');
    const impactApres = (await rappelApres.json()) as {
      data?: { affectedShipments?: { statutLivraison: string; dateLivraison: string | null }[] };
    };
    const ligneApres = impactApres.data?.affectedShipments?.find(() => true);
    assert(
      ligneApres?.statutLivraison === 'LIVRE',
      `l’impact du rappel annonce LIVRE (reçu ${ligneApres?.statutLivraison})`
    );
    assert(
      typeof ligneApres?.dateLivraison === 'string',
      'et la DATE, sans laquelle le décideur ne sait pas depuis quand c’est en rayon'
    );

    console.log('\n[7] Rejeu et gardes');
    const rejeu = await call(`/logistics/shipments/${shipmentId}/delivered`, 'POST', {});
    const rejeuBody = (await rejeu.json()) as { data?: { lots_livres: number } };
    assert(rejeu.status === 200, `rejouer → 200 idempotent (reçu ${rejeu.status})`);
    assert(rejeuBody.data?.lots_livres === 0, 'sans rien resceller');

    const futur = await call(`/logistics/shipments/${shipmentId}/delivered`, 'POST', {
      date_livraison: new Date(Date.now() + 86_400_000).toISOString(),
    });
    assert(futur.status === 200, 'une expédition déjà livrée reste idempotente');
    const apresFutur = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    assert(
      apresFutur.date_livraison?.getTime() === apres.date_livraison?.getTime(),
      'et la date retenue n a PAS bougé — l assertion precedente l affirmait sans le verifier'
    );

    const malforme = await call('/logistics/shipments/exp-1/delivered', 'POST', {});
    assert(malforme.status === 400, `identifiant non-uuid → 400 (reçu ${malforme.status})`);

    console.log('\n[8] Le rôle le plus faible est refusé, en HTTP réel');
    const lecteur = await signInAsOperator(prisma, {
      apiBase: API_URL,
      apiKey: API_KEY,
      organizationId: ORG_ID,
      email: 'e2e-viewer-livraison@nutrichain.local',
      role: 'viewer',
    });
    const refus = await fetch(`${API_URL}/api/logistics/shipments/${shipmentId}/delivered`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${lecteur.token}`,
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: '{}',
    });
    assert(refus.status === 403, `un viewer ne confirme pas une livraison → 403 (reçu ${refus.status})`);
  } finally {
    // On ne touche PAS à Audit_Log : la chaîne est chaînée par hash.
    //
    // Nettoyage par le LOT, pas par l'identifiant d'expédition : un échec avant la lecture de la
    // réponse laisse `shipmentId` vide, la suppression du lot butait alors sur sa clé étrangère et
    // laissait TOUT derrière. Constaté au premier passage de ce scénario.
    await prisma.liaison_Shipment.deleteMany({ where: { id_lot: lot.id } });
    await prisma.batch_Mouvement.deleteMany({ where: { id_lot: lot.id } });
    await prisma.alert.deleteMany({ where: { related_id: lot.id } });
    if (shipmentId) {
      await prisma.ePCIS_Event.deleteMany({ where: { related_id: shipmentId } });
    }
    await prisma.shipment.deleteMany({ where: { shipment_id: `E2E-LIV-${stamp}` } });
    await prisma.batch.deleteMany({ where: { id: lot.id } });
    // Les comptes de scenario ne survivent pas au scenario : celui de qualite pourrait declencher
    // un rappel produit, et son mot de passe est publie dans le depot.
    const jetables = ['e2e-quality-livraison@nutrichain.local', 'e2e-viewer-livraison@nutrichain.local'];
    const comptes = await prisma.user.findMany({ where: { email: { in: jetables } }, select: { id: true } });
    const idsComptes = comptes.map((u) => u.id);
    await prisma.member.deleteMany({ where: { userId: { in: idsComptes } } });
    await prisma.session.deleteMany({ where: { userId: { in: idsComptes } } });
    await prisma.account.deleteMany({ where: { userId: { in: idsComptes } } });
    await prisma.user.deleteMany({ where: { id: { in: idsComptes } } });
    await prisma.$disconnect();
  }

  if (failures.length > 0) {
    console.error(`\n[E2E] ❌ ${failures.length} assertion(s) en échec.`);
    process.exit(1);
  }
  console.log('\n[E2E] ✅ toutes les assertions passent.');
}

main().catch(async (error) => {
  console.error('[E2E] erreur inattendue', error);
  process.exit(1);
});
