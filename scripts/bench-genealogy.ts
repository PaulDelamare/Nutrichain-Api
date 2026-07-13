/**
 * Bench — CTE de généalogie (issue #21).
 *
 * Mesure le plan d'exécution et le temps de la récursion descendante/ascendante sur une
 * généalogie volumineuse (profondeur + largeur), pour décider — PREUVES À L'APPUI — si un
 * index couvrant sur `TransformationComposition` apporte un gain réel (anti-optimisation prématurée).
 *
 * Pré-requis : DB up + seed + .env (API_KEY_ORG_ID).
 * Lancement : npm run bench:genealogy
 *
 * Ce script SEED des données de test puis les SUPPRIME (cleanup en finally).
 *
 * CONSTAT (mesure du 2026-06-21, 4645 nœuds = chaîne 45 + 4500 feuilles) :
 *  - Récursion descendante ~21 ms. Le rappel a un budget objectif de 15 min → marge de ~6 ordres
 *    de grandeur, sur une opération manuelle et rare. Aucune pression de performance réelle.
 *  - Le terme récursif fait un `Hash Join` + `Seq Scan` de TransformationComposition (choix du
 *    planner, optimal à cette taille). Un index couvrant `(id_lot_parent, id_transformation)` a été
 *    testé : il ne change NI le plan NI le temps → NON retenu (YAGNI / pas d'optimisation prématurée).
 *  - L'index existant `@@index([id_lot_parent])` laisse déjà le planner basculer vers un nested-loop
 *    indexé si la table grossit assez pour rendre le seq-scan coûteux.
 *  - Ce script reste comme garde de non-régression perf / sonde de scalabilité à plus grand volume.
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/shared/configs/prismaClient.config';
import {
  downstreamTraceCte,
  MAX_GENEALOGY_DEPTH,
  genealogyService,
} from '../src/modules/traceability/transformations/services/genealogy.service';

const ORG_ID = process.env.API_KEY_ORG_ID;
if (!ORG_ID) {
  console.error('[BENCH] API_KEY_ORG_ID requis dans .env');
  process.exit(1);
}

// Paramètres de la généalogie synthétique.
const CHAIN_DEPTH = 45; // proche de MAX_GENEALOGY_DEPTH (50) pour exercer la récursion en profondeur
const LEAVES_PER_NODE = 100; // largeur : enfants-feuilles par maillon de la chaîne

interface SeedResult {
  sourceId: string;
  deepestLeafId: string;
  batchIds: string[];
  transfoIds: string[];
}

async function refs() {
  const member = await prisma.member.findFirst({ where: { organizationId: ORG_ID! } });
  const product = await prisma.product.findFirst({ where: { organization_id: ORG_ID! } });
  if (!member || !product) throw new Error('member/product seedé manquant.');
  let equipment = await prisma.equipment.findFirst({ where: { organization_id: ORG_ID! } });
  if (!equipment) {
    let location = await prisma.location.findFirst({ where: { organization_id: ORG_ID! } });
    if (!location) {
      location = await prisma.location.create({
        data: { organization_id: ORG_ID!, nom: 'Bench-Loc', type: 'WAREHOUSE' },
      });
    }
    equipment = await prisma.equipment.create({
      data: { organization_id: ORG_ID!, nom: 'Bench-Eq', type: 'MIXER', id_lieu: location.id },
    });
  }
  return { member, product, equipment };
}

async function seed(): Promise<SeedResult> {
  const { member, product, equipment } = await refs();

  const batchIds: string[] = [];
  const edges: { child: string; parent: string }[] = [];

  const mkId = () => {
    const id = randomUUID();
    batchIds.push(id);
    return id;
  };

  // Chaîne profonde : source -> c1 -> ... -> cD
  const sourceId = mkId();
  const chain = [sourceId];
  for (let d = 1; d <= CHAIN_DEPTH; d++) {
    const child = mkId();
    edges.push({ child, parent: chain[d - 1] });
    chain.push(child);
  }
  const deepestLeafId = chain[chain.length - 1];

  // Largeur : feuilles accrochées à chaque maillon
  for (const node of chain) {
    for (let k = 0; k < LEAVES_PER_NODE; k++) {
      const leaf = mkId();
      edges.push({ child: leaf, parent: node });
    }
  }

  // Insertion en masse (UUID pré-générés)
  await prisma.batch.createMany({
    data: batchIds.map((id) => ({
      id,
      lot_number: id,
      organization_id: ORG_ID!,
      id_produit: product.id,
      quantite_actuelle: 1,
      unite_code: product.unite_reference,
      quantite_base: 1,
      statut: 'EN_STOCK',
      created_by: member.userId,
    })),
  });

  const transfoIds = edges.map(() => randomUUID());
  await prisma.transformation.createMany({
    data: edges.map((e, i) => ({
      id: transfoIds[i],
      id_lot_enfant: e.child,
      id_produit_fini: product.id,
      id_user: member.userId,
      id_materiel: equipment.id,
      statut: 'TERMINE',
    })),
  });
  await prisma.transformationComposition.createMany({
    data: edges.map((e, i) => ({
      id_transformation: transfoIds[i],
      id_lot_parent: e.parent,
      quantite_prelevee: 1,
      unite: product.unite_reference,
      lot_parent_epuise: false,
    })),
  });

  return { sourceId, deepestLeafId, batchIds, transfoIds };
}

async function explainDownstream(sourceId: string): Promise<string> {
  const rows = await prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(Prisma.sql`
    EXPLAIN (ANALYZE, BUFFERS, TIMING)
    ${downstreamTraceCte(sourceId, MAX_GENEALOGY_DEPTH)}
    SELECT count(*) FROM downstream_trace
  `);
  return rows.map((r) => r['QUERY PLAN']).join('\n');
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = process.hrtime.bigint();
  const res = await fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  ${label}: ${ms.toFixed(1)} ms`);
  return res;
}

async function main() {
  console.log(
    `[BENCH] Généalogie — chaîne ${CHAIN_DEPTH} + ${LEAVES_PER_NODE} feuilles/maillon (org ${ORG_ID})`
  );
  let seeded: SeedResult | null = null;
  try {
    console.log('\n[BENCH] Seed...');
    const t0 = process.hrtime.bigint();
    seeded = await seed();
    console.log(
      `  ${seeded.batchIds.length} lots / ${seeded.transfoIds.length} transformations en ${(
        Number(process.hrtime.bigint() - t0) / 1e6
      ).toFixed(0)} ms`
    );

    console.log('\n[BENCH] EXPLAIN (ANALYZE, BUFFERS) — récursion descendante depuis la source :');
    console.log(await explainDownstream(seeded.sourceId));

    console.log('\n[BENCH] Temps applicatifs (3 itérations) :');
    for (let i = 0; i < 3; i++) {
      await timed(`getDownstream(source) #${i + 1}`, () =>
        genealogyService.getDownstream(seeded!.sourceId, ORG_ID!)
      );
    }
    await timed('getUpstream(feuille profonde)', () =>
      genealogyService.getUpstream(seeded!.deepestLeafId, ORG_ID!)
    );
  } catch (err) {
    console.error('[BENCH] Erreur:', err);
    process.exitCode = 1;
  } finally {
    if (seeded) {
      console.log('\n[BENCH] Cleanup...');
      await prisma.transformationComposition.deleteMany({
        where: { id_transformation: { in: seeded.transfoIds } },
      });
      await prisma.transformation.deleteMany({ where: { id: { in: seeded.transfoIds } } });
      // Les mouvements référencent le lot (FK) : les purger d'abord.
      await prisma.batch_Mouvement.deleteMany({ where: { id_lot: { in: seeded.batchIds } } });
      await prisma.batch_Mouvement.deleteMany({ where: { id_lot: { in: seeded.batchIds } } });
      await prisma.batch.deleteMany({ where: { id: { in: seeded.batchIds } } });
      console.log('  fixtures supprimées');
    }
    await prisma.$disconnect();
  }
}

main();
