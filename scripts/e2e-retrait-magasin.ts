/**
 * E2E — retirer un lot du rayon d'un magasin, par HTTP réel, jusqu'à refermer la boucle du rappel.
 *
 * L'issue #254 dit le défaut : deux écritures complètes et testées (`scrap`, `moveBatch`) n'étaient
 * appelables par aucune interface. Un endpoint qu'aucun parcours n'exerce est exactement ça. Ce
 * scénario joue donc la chaîne entière — session, rôle, plafond, cumul, lecture d'avancement — et
 * pas seulement le service.
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

interface CustomerProgress {
  customerId: string;
  customerName: string;
  quantiteLivree: string;
  quantiteRetiree: string;
  resteARetirer: string;
  retraits: unknown[];
}

async function main(): Promise<void> {
  if (!ORG_ID) throw new Error('API_KEY_ORG_ID manquant dans .env');

  // Sonde d'abord : sans serveur, l'échec se manifesterait par une pile levée dans le helper de
  // connexion, symptôme d'un problème d'authentification. Leçon de `e2e:recall-simulation`.
  const health = await fetch(`${API_URL}/api/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error(
      `Aucune API ne répond sur ${API_URL}. Démarrer le serveur avant ce scénario ` +
        `(en CI : placer l'étape APRÈS « Démarrer l'API en arrière-plan »).`
    );
  }

  const stamp = Date.now().toString().slice(-9);
  const unit = await prisma.unit.findFirstOrThrow();
  const product = await prisma.product.findFirstOrThrow({ where: { organization_id: ORG_ID } });

  const quality = await signInAsOperator(prisma, {
    apiBase: API_URL,
    apiKey: API_KEY,
    organizationId: ORG_ID,
    email: 'e2e-quality-retrait@nutrichain.local',
    role: 'quality',
  });

  const viewer = await signInAsOperator(prisma, {
    apiBase: API_URL,
    apiKey: API_KEY,
    organizationId: ORG_ID,
    email: 'e2e-viewer-retrait@nutrichain.local',
    role: 'viewer',
  });

  console.log('\n[E2E] Fixtures : un lot livré à un magasin, un autre encore en route.');

  const batch = await prisma.batch.create({
    data: {
      organization_id: ORG_ID,
      lot_number: `E2E-RETRAIT-${stamp}`,
      id_produit: product.id,
      unite_code: unit.code,
      quantite_actuelle: 0,
      quantite_base: 60,
      statut: 'ALERTE',
      created_by: quality.userId,
    },
    select: { id: true },
  });

  const customer = await prisma.customer.create({
    data: {
      organization_id: ORG_ID,
      nom_enseigne: `Magasin E2E ${stamp}`,
      adresse_livraison: '4 rue du Rayon',
    },
    select: { id: true, nom_enseigne: true },
  });

  const expedier = async (quantite: number, livree: boolean, suffixe: string) => {
    const shipment = await prisma.shipment.create({
      data: {
        organization_id: ORG_ID,
        id_client: customer.id,
        shipment_id: `E2E-RETRAIT-SHIP-${suffixe}-${stamp}`,
        date_envoi: new Date(),
        transporteur: 'TransFroid E2E',
        statut_livraison: livree ? 'LIVRE' : 'EN_ROUTE',
        ...(livree ? { date_livraison: new Date(), delivered_by: quality.userId } : {}),
        created_by: quality.userId,
      },
      select: { id: true },
    });
    await prisma.liaison_Shipment.create({
      data: {
        id_expedition: shipment.id,
        id_lot: batch.id,
        quantite_expediee: quantite,
        unite: unit.code,
      },
    });
    return shipment.id;
  };

  const shipmentLivree = await expedier(40, true, 'LIVREE');
  const shipmentEnRoute = await expedier(100, false, 'EN-ROUTE');

  try {
    console.log('\n[E2E] 1. Ce que le retrait doit refuser.');

    const anonyme = await fetch(`${API_URL}/api/logistics/batches/${batch.id}/withdrawals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ id_client: customer.id, quantite: 1, motif: 'Sans session' }),
    });
    assert(anonyme.status === 401, 'sans session : 401');

    const lectureSeule = await call(
      `/logistics/batches/${batch.id}/withdrawals`,
      viewer.token,
      'POST',
      { id_client: customer.id, quantite: 1, motif: 'Role en lecture seule' }
    );
    assert(lectureSeule.status === 403, 'le rôle en lecture seule est refusé');

    const trop = await call(`/logistics/batches/${batch.id}/withdrawals`, quality.token, 'POST', {
      id_client: customer.id,
      quantite: 60,
      motif: 'Au-dela de ce qui est livre',
    });
    assert(
      trop.status === 409,
      'un retrait supérieur au livré est refusé, même si 100 sont en route'
    );

    console.log('\n[E2E] 2. Le geste, répétable, jusqu’au plafond.');

    const premier = await call(
      `/logistics/batches/${batch.id}/withdrawals`,
      quality.token,
      'POST',
      {
        id_client: customer.id,
        quantite: 30,
        motif: 'Retrait du soir',
        constate_aupres_de: 'Responsable rayon frais',
      }
    );
    const premierCorps = (await premier.json()) as { data: { resteARetirer: string; unite: string } };
    assert(premier.status === 201, 'le premier retrait est enregistré');
    assert(premierCorps.data.resteARetirer === '10', 'le reste à retirer est annoncé (10)');
    assert(
      premierCorps.data.unite === unit.code,
      `l'unité vient du lot (${premierCorps.data.unite})`
    );

    const second = await call(`/logistics/batches/${batch.id}/withdrawals`, quality.token, 'POST', {
      id_client: customer.id,
      quantite: 10,
      motif: 'Reserve videe le lendemain',
    });
    assert(second.status === 201, 'une seconde déclaration est acceptée, pas avalée');

    const troisieme = await call(
      `/logistics/batches/${batch.id}/withdrawals`,
      quality.token,
      'POST',
      { id_client: customer.id, quantite: 1, motif: 'Un de trop' }
    );
    assert(troisieme.status === 409, 'le plafond atteint refuse la déclaration suivante');

    console.log("\n[E2E] 3. L'avancement, lisible par tous les rôles.");

    const avancement = await call(`/logistics/batches/${batch.id}/withdrawals`, viewer.token);
    const corps = (await avancement.json()) as { data: { clients: CustomerProgress[] } };
    const ligne = corps.data.clients.find((c) => c.customerId === customer.id);

    assert(avancement.status === 200, 'un viewer lit l’avancement');
    assert(
      avancement.headers.get('cache-control') === 'no-store',
      'la lecture interdit la mise en cache'
    );
    assert(ligne?.customerName === customer.nom_enseigne, 'le magasin est nommé');
    assert(ligne?.quantiteLivree === '40', 'le livré ignore les 100 encore en route');
    assert(ligne?.quantiteRetiree === '40' && ligne?.resteARetirer === '0', 'la boucle est fermée');
    assert(ligne?.retraits.length === 2, 'les deux déclarations sont conservées');

    console.log('\n[E2E] 4. Ce que le retrait ne change PAS.');

    const apres = await prisma.batch.findFirstOrThrow({
      where: { id: batch.id },
      select: { statut: true, quantite_actuelle: true },
    });
    assert(
      apres.statut === 'ALERTE',
      'le lot reste sous rappel : retirer du rayon n’est pas lever un rappel'
    );

    const maillon = await prisma.audit_Log.findFirst({
      where: { organization_id: ORG_ID, entity: 'Withdrawal' },
      orderBy: { id: 'desc' },
      select: { action: true },
    });
    assert(
      maillon?.action === 'BATCH_WITHDRAWN_FROM_SHELF',
      'la décision est scellée dans la chaîne WORM'
    );
  } finally {
    console.log('\n[E2E] Nettoyage des fixtures.');
    await prisma.withdrawal.deleteMany({ where: { id_lot: batch.id } });
    await prisma.batch_Mouvement.deleteMany({ where: { id_lot: batch.id } });
    await prisma.liaison_Shipment.deleteMany({ where: { id_lot: batch.id } });
    await prisma.shipment.deleteMany({ where: { id: { in: [shipmentLivree, shipmentEnRoute] } } });
    await prisma.batch.deleteMany({ where: { id: batch.id } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
    // Les maillons d'audit RESTENT : les retirer romprait le chaînage de l'organisation (#291).
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
