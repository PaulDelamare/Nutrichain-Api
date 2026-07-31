/**
 * E2E — la palette par HTTP RÉEL, et l'excursion thermique qui la bloque en entier.
 *
 * Ce scénario existe parce que les autres ne prouvent pas ce qui compte le plus :
 *
 * 1. `e2e:logistic-unit` appelle les SERVICES directement, et le test de route mocke le
 *    contrôleur. Le câblage HTTP complet — session réelle, validation montée, garde de rôle,
 *    contrôleur, service — n'était donc prouvé par rien. C'est exactement la classe de défaut
 *    « fonctionnalité terminée et testée, et la route renvoie 401 ».
 * 2. Le gain annoncé du modèle — « une excursion bloque toute la palette » — n'était qu'une
 *    déduction. Ici on déclenche une VRAIE excursion sur le frigo où la palette est rangée, et on
 *    exige que TOUS ses lots passent en quarantaine.
 *
 * Pré-requis : Postgres + Mongo + migrations + seed + **serveur en marche** (comme les autres
 * scénarios HTTP de la CI). Lancement : npm run e2e:palette-http
 */
import mongoose from 'mongoose';
import { prisma } from '../src/shared/configs/prismaClient.config';
import { connectMongoDB, disconnectMongoDB } from '../src/shared/configs/mongoClient.config';
import { TelemetryModel } from '../src/modules/iot/models/telemetry.model';
import { iotAlertService } from '../src/modules/iot/services/iotAlert.service';
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

/** Déclenche une excursion réelle, dans la même session Mongo qu'en production. */
async function ingestPing(sensorId: string, temperature: number, minutesAgo = 0): Promise<void> {
  const ts = new Date(Date.now() - minutesAgo * 60_000);
  const session = await mongoose.startSession();
  try {
    await TelemetryModel.create(
      [
        {
          metadata: { sensor_id: sensorId, organization_id: ORG_ID! },
          timestamp: ts,
          temperature,
          humidity: 50,
          battery_level: 80,
        },
      ],
      { session }
    );
    await iotAlertService.checkAndAlert({
      sensorId,
      organizationId: ORG_ID!,
      currentTemp: temperature,
      timestamp: ts,
      mongoSession: session,
    });
  } finally {
    await session.endSession();
  }
}

async function main(): Promise<void> {
  if (!ORG_ID) throw new Error('API_KEY_ORG_ID manquant dans .env');
  await connectMongoDB();

  const stamp = Date.now().toString().slice(-9);
  const sensorId = `E2E-PAL-SENSOR-${stamp}`;
  const unit = await prisma.unit.findFirstOrThrow();
  const product = await prisma.product.findFirstOrThrow({ where: { organization_id: ORG_ID } });
  const location = await prisma.location.findFirstOrThrow({ where: { organization_id: ORG_ID } });

  // Frigo surveillé, dédié au scénario : on ne déclenche pas d'excursion sur un matériel partagé.
  const fridge = await prisma.equipment.create({
    data: {
      organization_id: ORG_ID,
      nom: `E2E-PAL-FRIGO-${stamp}`,
      type: 'FRIGO',
      id_lieu: location.id,
      qr_code_id: `E2E-PAL-QR-${stamp}`,
      sensor_id: sensorId,
      temp_seuil_max: 4,
    },
  });

  const session = await signInAsOperator(prisma, {
    apiBase: API_URL,
    apiKey: API_KEY,
    organizationId: ORG_ID,
  });
  token = session.token;

  const makeBatch = (suffix: string) =>
    prisma.batch.create({
      data: {
        organization_id: ORG_ID!,
        id_produit: product.id,
        lot_number: `E2E-PAL-${stamp}-${suffix}`,
        quantite_actuelle: 60,
        quantite_base: 60,
        unite_code: unit.code,
        statut: 'EN_STOCK',
        created_by: session.userId,
      },
    });

  const lotA = await makeBatch('A');
  const lotB = await makeBatch('B');
  // Deux lots de plus, réservés à l'ouverture : les premiers finissent en quarantaine à l'étape 6,
  // donc ils ne seraient plus repalettisables et ne pourraient pas prouver l'étape 13.
  const lotC = await makeBatch('C');
  const lotD = await makeBatch('D');
  const createdBatches = [lotA.id, lotB.id, lotC.id, lotD.id];
  // Les etapes 1 a 7 ne concernent QUE la premiere palette : y boucler sur tous les lots crees
  // ferait echouer leurs assertions a cause des lots reserves a l ouverture.
  const lotsPalette1 = [lotA.id, lotB.id];
  let palletId = '';
  let palletOuvrableId = '';
  let repalettiseId = '';

  try {
    console.log('\n[1] Constituer la palette — par HTTP, avec une vraie session opérateur');
    const created = await call('/logistics/logistic-units', 'POST', {
      items: [
        { id_lot: lotA.id, quantite: 30 },
        { id_lot: lotB.id, quantite: 20 },
      ],
    });
    assert(created.status === 201, `POST /logistics/logistic-units → 201 (reçu ${created.status})`);
    const createdBody = (await created.json()) as { data?: { id: string; sscc: string } };
    palletId = createdBody.data?.id ?? '';
    const sscc = createdBody.data?.sscc ?? '';
    assert(/^\d{18}$/.test(sscc), `le SSCC rendu fait 18 chiffres (${sscc})`);

    console.log('\n[2] Ranger la palette — LA route que rien ne prouvait');
    const ranged = await call(`/logistics/logistic-units/${palletId}/location`, 'PATCH', {
      id_materiel: fridge.id,
    });
    assert(ranged.status === 200, `PATCH .../location → 200 (reçu ${ranged.status})`);
    const rangedBody = (await ranged.json()) as { data?: { lots_deplaces: number } };
    assert(rangedBody.data?.lots_deplaces === 2, 'la réponse annonce 2 lots déplacés');

    const positions = await prisma.batch.findMany({
      where: { id: { in: lotsPalette1 } },
      select: { id_materiel_actuel: true },
    });
    assert(
      positions.every((p) => p.id_materiel_actuel === fridge.id),
      'les deux lots portent la position du frigo, en base'
    );

    console.log('\n[3] Le scan HTTP rend le contenu de la palette');
    const scanned = await call(`/logistics/logistic-units/by-sscc/${sscc}`);
    assert(scanned.status === 200, `GET .../by-sscc → 200 (reçu ${scanned.status})`);
    const scanBody = (await scanned.json()) as { data?: { lots: unknown[] } };
    assert(scanBody.data?.lots.length === 2, 'le scan rend les deux lots');

    console.log('\n[4] Sans session, la route de rangement refuse (401)');
    const anonyme = await fetch(`${API_URL}/api/logistics/logistic-units/${palletId}/location`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ id_materiel: fridge.id }),
    });
    assert(anonyme.status === 401, `PATCH sans session → 401 (reçu ${anonyme.status})`);

    console.log('\n[5] Validation réellement montée : sans emplacement, 400');
    const sansMateriel = await call(`/logistics/logistic-units/${palletId}/location`, 'PATCH', {});
    assert(sansMateriel.status === 400, `PATCH sans id_materiel → 400 (reçu ${sansMateriel.status})`);

    console.log('\n[6] LE GAIN DU MODÈLE — une excursion bloque TOUTE la palette');
    await TelemetryModel.deleteMany({ 'metadata.sensor_id': sensorId });
    // La détection exige au moins 5 points dans la fenêtre, dont 80 % au-dessus du seuil
    // (`excursionDetection.service`) : deux ou trois relevés ne déclenchent RIEN, à dessein — on
    // n'immobilise pas un stock sur un pic isolé de capteur. Six points montants, comme une vraie
    // panne de groupe froid.
    for (const [minutesAgo, temp] of [
      [10, 7],
      [8, 8],
      [6, 9],
      [4, 10],
      [2, 11],
      [0, 12],
    ] as const) {
      await ingestPing(sensorId, temp, minutesAgo);
    }

    const apresExcursion = await prisma.batch.findMany({
      where: { id: { in: lotsPalette1 } },
      select: { lot_number: true, statut: true, statut_avant_blocage: true },
    });
    assert(
      apresExcursion.every((b) => b.statut === 'BLOQUE'),
      `les DEUX lots de la palette sont en quarantaine (${apresExcursion.map((b) => b.statut).join(', ')})`
    );
    assert(
      apresExcursion.every((b) => b.statut_avant_blocage === 'EN_STOCK'),
      'leur statut d’origine est mémorisé pour la levée'
    );
    assert(
      apresExcursion.length === 2,
      'aucun lot de la palette n’a échappé au blocage'
    );

    console.log('\n[7] Le scan signale désormais la palette comme non saine');
    const scanApres = await call(`/logistics/logistic-units/by-sscc/${sscc}`);
    const scanApresBody = (await scanApres.json()) as {
      data?: { lots: { statut: string }[] };
    };
    assert(
      scanApresBody.data?.lots.every((l) => l.statut === 'BLOQUE') === true,
      'le scan montre les deux lots bloqués — l’opérateur le voit sur le quai'
    );

    console.log('\n[8] Ouvrir une palette — le contenant cesse d’exister, la marchandise reste');
    const seconde = await call('/logistics/logistic-units', 'POST', {
      items: [
        { id_lot: lotC.id, quantite: 25 },
        { id_lot: lotD.id, quantite: 15 },
      ],
    });
    const secondeBody = (await seconde.json()) as { data?: { id: string; sscc: string } };
    palletOuvrableId = secondeBody.data?.id ?? '';
    const ssccOuvrable = secondeBody.data?.sscc ?? '';
    assert(seconde.status === 201, `seconde palette créée (reçu ${seconde.status})`);

    await call(`/logistics/logistic-units/${palletOuvrableId}/location`, 'PATCH', {
      id_materiel: fridge.id,
    });

    const ouverte = await call(`/logistics/logistic-units/${palletOuvrableId}/open`, 'POST');
    assert(ouverte.status === 200, `POST .../open → 200 (reçu ${ouverte.status})`);
    const ouverteBody = (await ouverte.json()) as { data?: { lots_detaches: number } };
    assert(ouverteBody.data?.lots_detaches === 2, 'la réponse annonce 2 lots détachés');

    console.log('\n[9] En base : le contenant est vidé, la marchandise n’a pas bougé');
    const uniteOuverte = await prisma.logistic_Unit.findUniqueOrThrow({
      where: { id: palletOuvrableId },
      include: { contenu: true },
    });
    assert(uniteOuverte.contenu.length === 0, 'plus aucune ligne de contenu');
    assert(uniteOuverte.opened_at !== null, 'l’ouverture est datée');
    assert(uniteOuverte.opened_by === session.userId, 'l’auteur de l’ouverture est celui de la session');

    const lotsApresOuverture = await prisma.batch.findMany({
      where: { id: { in: [lotC.id, lotD.id] } },
      select: { statut: true, id_materiel_actuel: true },
    });
    assert(
      lotsApresOuverture.every((l) => l.id_materiel_actuel === fridge.id),
      'ouvrir n’a DÉPLACÉ aucun lot : ils sont toujours dans le frigo'
    );
    assert(
      lotsApresOuverture.every((l) => l.statut === 'EN_STOCK'),
      'ouvrir n’a modifié aucun statut : ce n’est pas une décision sanitaire'
    );

    console.log('\n[10] La containment GS1 est refermée, sur le MÊME parentID que l’agrégation');
    const evenements = await prisma.ePCIS_Event.findMany({
      where: { related_id: palletOuvrableId },
      orderBy: { id: 'asc' },
    });
    // On désigne les événements par leur ACTION, jamais par leur position : l'ordre des
    // identifiants entre deux transactions n'est garanti par rien, et une assertion qui en dépend
    // passe ou échoue au hasard — constaté une fois sur ce scénario même.
    const charge = (evenement: (typeof evenements)[number] | undefined) =>
      (evenement?.payload as { parentID?: string; action?: string } | null) ?? {};
    const ajout = evenements.find((evenement) => charge(evenement).action === 'ADD');
    const retrait = evenements.find((evenement) => charge(evenement).action === 'DELETE');
    assert(evenements.length === 2, `2 événements EPCIS pour cette palette (reçu ${evenements.length})`);
    assert(!!ajout && !!retrait, 'un ADD au packing, un DELETE à l’ouverture');
    // Une containment ne se ferme QUE si le parentID est strictement le même : un préfixe GS1
    // recomposé différemment laisserait les deux événements côte à côte sans jamais se répondre.
    assert(
      charge(ajout).parentID === charge(retrait).parentID && !!charge(retrait).parentID,
      `le DELETE porte le même parentID que l’ADD (${charge(retrait).parentID})`
    );

    console.log('\n[11] Le geste est scellé dans le journal WORM');
    const maillon = await prisma.audit_Log.findFirst({
      where: { organization_id: ORG_ID, action: 'OPEN_LOGISTIC_UNIT', entity_id: palletOuvrableId },
    });
    assert(maillon !== null, 'un maillon OPEN_LOGISTIC_UNIT existe');
    const valeur = maillon?.nouvelle_valeur as { lots?: { quantite: number }[] } | null;
    assert(
      valeur?.lots?.length === 2 && valeur.lots.every((l) => typeof l.quantite === 'number'),
      'il conserve les quantités détachées, que la base ne porte plus'
    );

    console.log('\n[12] Rescanner l’étiquette dit ce que la palette portait — pas « rien »');
    const scanOuverte = await call(`/logistics/logistic-units/by-sscc/${ssccOuvrable}`);
    const scanOuverteBody = (await scanOuverte.json()) as {
      data?: {
        ouverture: { date: string } | null;
        lots: { statut: string }[];
        dernier_contenu: { quantite_a_l_ouverture: number; statut: string }[];
      };
    };
    assert(scanOuverte.status === 200, 'le SSCC reste résoluble après ouverture');
    // `!== null` serait vacu : si le champ disparaissait, `undefined !== null` vaudrait vrai et
    // l'assertion resterait verte sur une fonctionnalité supprimée.
    assert(
      typeof scanOuverteBody.data?.ouverture?.date === 'string',
      'le scan annonce la DATE d’ouverture'
    );
    assert(
      scanOuverteBody.data?.lots.length === 0,
      'la palette ne porte plus rien — `lots` est vide, et c’est exact'
    );
    assert(
      scanOuverteBody.data?.dernier_contenu.length === 2,
      'mais le dernier contenu connu reste lisible : la marchandise est encore physiquement dessus'
    );
    assert(
      typeof scanOuverteBody.data?.dernier_contenu[0]?.quantite_a_l_ouverture === 'number',
      'la quantité y porte son nom : un repère historique, pas un état de stock'
    );

    console.log('\n[13] Les lots redeviennent autonomes : repalettisables sous un NOUVEAU SSCC');
    const repalettise = await call('/logistics/logistic-units', 'POST', {
      items: [{ id_lot: lotC.id, quantite: 10 }],
    });
    const repalettiseBody = (await repalettise.json()) as { data?: { id: string; sscc: string } };
    repalettiseId = repalettiseBody.data?.id ?? '';
    assert(repalettise.status === 201, `le lot se repalettise (reçu ${repalettise.status})`);
    assert(
      repalettiseBody.data?.sscc !== ssccOuvrable && !!repalettiseBody.data?.sscc,
      'le SSCC de la palette ouverte n’est PAS réutilisé'
    );

    // LE point : rescanner l'ANCIEN SSCC après la repalettisation. Sans le filtrage à la lecture,
    // deux palettes revendiqueraient le même lot — l'invariant que la contrainte en base tient.
    const scanApresRepalettisation = await call(
      `/logistics/logistic-units/by-sscc/${ssccOuvrable}`
    );
    const apresRepalettisation = (await scanApresRepalettisation.json()) as {
      data?: { dernier_contenu: { id: string }[] };
    };
    assert(
      apresRepalettisation.data?.dernier_contenu.some((l) => l.id === lotC.id) === false,
      'l’ancien SSCC ne revendique plus le lot repalettisé ailleurs'
    );
    assert(
      apresRepalettisation.data?.dernier_contenu.length === 1,
      'il ne garde que le lot qui n’a pas bougé'
    );

    console.log('\n[14] Ce qu’une palette ouverte ne permet plus');
    // Idempotent : un double appui sur un quai en réseau faible ne doit pas signaler une erreur
    // pour un geste qui a réussi.
    const reouverture = await call(`/logistics/logistic-units/${palletOuvrableId}/open`, 'POST');
    const reouvertureBody = (await reouverture.json()) as { data?: { lots_detaches: number } };
    assert(reouverture.status === 200, `rouvrir → 200 idempotent (reçu ${reouverture.status})`);
    assert(reouvertureBody.data?.lots_detaches === 0, 'et n’en détache aucun de plus');

    const rangementApres = await call(
      `/logistics/logistic-units/${palletOuvrableId}/location`,
      'PATCH',
      { id_materiel: fridge.id }
    );
    const rangementBody = await rangementApres.text();
    assert(rangementApres.status === 409, `ranger → 409 (reçu ${rangementApres.status})`);
    assert(
      rangementBody.includes('ouverte'),
      'le refus dit « ouverte », et non « palette vide » qui enverrait la remplir'
    );

    const etiquette = await call(`/logistics/logistic-units/${palletOuvrableId}/label`);
    assert(etiquette.status === 409, `imprimer l’étiquette → 409 (reçu ${etiquette.status})`);

    // Payload COMPLET et client REEL, sinon la requête est refusée par la validation ou en 404
    // avant même d'atteindre la garde — l'assertion serait verte sans jamais l'exercer.
    const client = await prisma.customer.findFirstOrThrow({
      where: { organization_id: ORG_ID, is_active: true },
    });
    const chargement = await call('/logistics/shipments', 'POST', {
      id_client: client.id,
      shipment_id: `E2E-PAL-EXP-${stamp}`,
      transporteur: 'E2E Transport',
      destination_adresse: '1 rue de la Verification, 75001 Paris',
      palettes: [ssccOuvrable],
    });
    const chargementBody = await chargement.text();
    assert(chargement.status === 409, `expédier une palette ouverte → 409 (reçu ${chargement.status})`);
    assert(chargementBody.includes('ouverte'), 'et le refus dit bien qu’elle a été ouverte');

    console.log('\n[15] Un identifiant qui n’est pas un uuid est refusé avant la base');
    const malforme = await call('/logistics/logistic-units/palette-1/open', 'POST');
    assert(malforme.status === 400, `POST .../palette-1/open → 400 (reçu ${malforme.status})`);
  } finally {
    // Cleanup. On ne touche PAS à Audit_Log : la chaîne est chaînée par hash, en retirer une ligne
    // la romprait pour toute l'organisation.
    await prisma.batch_Mouvement.deleteMany({ where: { id_lot: { in: createdBatches } } });
    for (const id of [palletId, palletOuvrableId, repalettiseId].filter(Boolean)) {
      await prisma.logistic_Unit_Content.deleteMany({ where: { id_unite_logistique: id } });
      await prisma.ePCIS_Event.deleteMany({ where: { related_id: id } });
      await prisma.logistic_Unit.deleteMany({ where: { id } });
    }
    await prisma.batch.deleteMany({ where: { id: { in: createdBatches } } });
    await prisma.alert.deleteMany({ where: { id_materiel: fridge.id } });
    await prisma.equipment.deleteMany({ where: { id: fridge.id } });
    await TelemetryModel.deleteMany({ 'metadata.sensor_id': sensorId });
    await disconnectMongoDB();
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
