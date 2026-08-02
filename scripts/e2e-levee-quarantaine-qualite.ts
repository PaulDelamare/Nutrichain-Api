/**
 * E2E — la quarantaine QUALITÉ se lève, et seulement contre une contre-analyse.
 *
 * Un lot déclaré non conforme n'avait aucune porte de sortie : sa seule issue était le rebut, et un
 * contrôle saisi par erreur condamnait donc définitivement de la marchandise saine. Ce scénario
 * prouve, contre PostgreSQL réel, les invariants de la levée :
 *  1. la contre-analyse conforme s'ENREGISTRE sur un lot bloqué, sans rien libérer ;
 *  2. sans elle, la levée qualité refuse (409) ;
 *  3. la levée rend le lot à son statut d'AVANT le blocage — pas EN_STOCK ;
 *  4. le canal FROID reste fermé tant que la qualité retient le lot, et ne rouvre qu'après la
 *     contre-analyse : c'est la porte dérobée que l'enregistrement du CONFORME aurait ouverte ;
 *  5. le signataire de la non-conformité ne lève pas seul (séparation des tâches).
 *
 * Pré-requis : Postgres + migrations + seed, .env (API_KEY_ORG_ID).
 * Lancement : npm run e2e:levee-qualite
 */
import { prisma } from '../src/shared/configs/prismaClient.config';
import { batchService } from '../src/modules/logistics/shared/services/batch.service';
import { qualityControlService } from '../src/modules/organization/services/qualityControl.service';

const ORG_ID = process.env.API_KEY_ORG_ID;
if (!ORG_ID) {
  console.error('[E2E] API_KEY_ORG_ID requis dans .env');
  process.exit(1);
}

const failures: string[] = [];
function assert(condition: boolean, label: string) {
  if (!condition) {
    failures.push(label);
    console.error(`  ❌ ${label}`);
  } else {
    console.log(`  ✅ ${label}`);
  }
}

/** Le statut d'échec d'un appel, ou 0 s'il a abouti. */
async function statusOf(action: Promise<unknown>): Promise<number> {
  try {
    await action;
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? -1;
  }
}

async function main() {
  const stamp = Date.now();

  // Deux acteurs distincts : la séparation des tâches interdit au signataire de la non-conformité
  // de la lever lui-même. Tri explicite — `take: 2` sans ordre prend deux lignes arbitraires, et
  // réécrire un membre le déplace dans l'ordre physique de Postgres.
  const members = await prisma.member.findMany({
    where: { organizationId: ORG_ID!, role: { in: ['owner', 'admin', 'quality'] } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 2,
  });
  if (members.length < 2) throw new Error('Il faut au moins 2 membres habilités dans le seed.');
  const labTech = members[0].userId;
  const approver = members[1].userId;

  const product = await prisma.product.findFirst({ where: { organization_id: ORG_ID! } });
  const unit = await prisma.unit.findFirst();
  if (!product || !unit) throw new Error('Produit ou unité absent du seed.');

  // `EN_ATTENTE_QC` est LE statut qui compte : c'est lui qu'une levée bâclée transformerait en
  // `EN_STOCK`, rendant le lot expédiable sans avoir jamais franchi son contrôle de sortie.
  const batch = await prisma.batch.create({
    data: {
      organization_id: ORG_ID!,
      id_produit: product.id,
      lot_number: `E2E-LQ-${stamp}`,
      quantite_actuelle: 100,
      quantite_base: 100,
      unite_code: unit.code,
      statut: 'EN_ATTENTE_QC',
      created_by: labTech,
    },
  });

  console.log('\n[E2E] 1 — un contrôle non conforme condamne le lot, et mémorise son état');
  await qualityControlService.createQualityControl({
    organization_id: ORG_ID!,
    id_lot: batch.id,
    type_test: 'Analyse microbiologique',
    resultat: 'NON_CONFORME',
    id_user_labo: labTech,
  });
  const condemned = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
  assert(condemned.statut === 'BLOQUE', 'contrôle non conforme → lot BLOQUE');
  assert(
    condemned.statut_avant_blocage === 'EN_ATTENTE_QC',
    'statut_avant_blocage mémorise EN_ATTENTE_QC'
  );

  console.log('\n[E2E] 2 — sans contre-analyse, AUCUN canal ne libère le lot');
  assert(
    (await statusOf(
      batchService.liftQualityQuarantine(batch.id, ORG_ID!, approver, 'Sans contre-analyse')
    )) === 409,
    'levée qualité sans contre-analyse → 409'
  );
  assert(
    (await statusOf(
      batchService.liftQuarantine(batch.id, ORG_ID!, approver, 'Par le canal froid')
    )) === 409,
    'levée FROID d un lot condamné → 409'
  );

  console.log('\n[E2E] 3 — la contre-analyse conforme s’enregistre sans rien libérer');
  const counter = await qualityControlService.createQualityControl({
    organization_id: ORG_ID!,
    id_lot: batch.id,
    type_test: 'Contre-analyse microbiologique',
    resultat: 'CONFORME',
    id_user_labo: labTech,
  });
  assert(counter.statut_lot === 'BLOQUE', 'contre-analyse enregistrée, lot toujours BLOQUE');

  console.log('\n[E2E] 4 — le signataire de la non-conformité ne lève pas seul');
  assert(
    (await statusOf(
      batchService.liftQualityQuarantine(batch.id, ORG_ID!, labTech, 'Levée par le signataire')
    )) === 403,
    'levée par le signataire de la non-conformité → 403 (séparation des tâches)'
  );

  console.log('\n[E2E] 5 — la levée aboutit et rend le lot à son statut d’AVANT');
  await batchService.liftQualityQuarantine(
    batch.id,
    ORG_ID!,
    approver,
    'Contre-analyse microbiologique conforme'
  );
  const lifted = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
  assert(lifted.statut === 'EN_ATTENTE_QC', 'levée → lot revient EN_ATTENTE_QC');
  assert(lifted.statut !== 'EN_STOCK', 'levée → lot N EST PAS rendu expédiable');
  assert(lifted.statut_avant_blocage === null, 'statut_avant_blocage remis à null');

  const movement = await prisma.batch_Mouvement.findFirst({
    where: { id_lot: batch.id, type_action: 'LEVEE_QUARANTAINE_QUALITE' },
    orderBy: { id: 'desc' },
  });
  assert(movement !== null, 'mouvement LEVEE_QUARANTAINE_QUALITE tracé');
  // Type DISTINCT de la levée froid : `alertBatch.service` lit `LEVEE_QUARANTAINE` pour savoir si
  // une isolation froid a été levée. Les confondre lui ferait croire qu'un frigo a été traité.
  assert(
    (await prisma.batch_Mouvement.count({
      where: { id_lot: batch.id, type_action: 'LEVEE_QUARANTAINE' },
    })) === 0,
    'aucun mouvement LEVEE_QUARANTAINE : les deux canaux ne se confondent pas'
  );

  const audit = await prisma.audit_Log.findFirst({
    where: { organization_id: ORG_ID!, entity_id: batch.id, action: 'LIFT_QUALITY_QUARANTINE' },
    orderBy: { id: 'desc' },
  });
  assert(audit !== null, 'décision scellée dans le journal WORM');
  assert(
    (audit?.nouvelle_valeur as { id_contre_analyse?: string } | null)?.id_contre_analyse !==
      undefined,
    'la ligne d audit porte la contre-analyse qui justifie la levée'
  );

  console.log('\n[E2E] 6 — le canal froid, lui, a rouvert une fois la non-conformité démentie');
  // C'est l'invariant fragile : enregistrer un CONFORME sur un lot bloqué le rend « dernier
  // verdict ». Une garde qui lisait le dernier verdict laissait alors passer la levée froid sur un
  // lot condamné. Ici la condamnation est réellement levée, donc le canal froid doit rouvrir.
  await prisma.batch.update({
    where: { id: batch.id },
    data: { statut: 'BLOQUE', statut_avant_blocage: 'EN_ATTENTE_QC' },
  });
  assert(
    (await statusOf(
      batchService.liftQuarantine(batch.id, ORG_ID!, approver, 'Frigo réparé')
    )) === 0,
    'non-conformité démentie → la levée froid redevient possible'
  );

  await prisma.batch_Mouvement.deleteMany({ where: { id_lot: batch.id } });
  await prisma.qualityControl.deleteMany({ where: { id_lot: batch.id } });
  await prisma.batch.delete({ where: { id: batch.id } });
  await prisma.$disconnect();

  if (failures.length > 0) {
    console.error(`\n[E2E] ❌ ${failures.length} assertion(s) en échec.`);
    process.exit(1);
  }
  console.log('\n[E2E] ✅ Tous les scénarios passent.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
