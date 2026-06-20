import { prisma } from '../src/shared/configs/prismaClient.config';
import { auditService } from '../src/shared/utils/audit/audit.service';
import { genealogyService } from '../src/modules/traceability/transformations/services/genealogy.service';
import crypto from 'crypto';

/**
 * NUTRICHAIN — E2E Security Fixes
 *
 * Valide bout-en-bout les 9 commits de durcissement P0/P1 contre un serveur
 * réel (lancer `npm run dev` dans un autre terminal) et la base PostgreSQL
 * configurée par DATABASE_URL.
 *
 * Scénarios :
 *   1. Spoofing x-org-id rejeté (Sec A)
 *   2. Bypass tenant supprimé sur les middlewares logistiques (Sec B)
 *   3. Public scan filtre EXPEDIE/ALERTE (Sec C)
 *   4. Chaîne WORM recompute exacte (WORM A)
 *   5. Audit_Log onDelete: Restrict (WORM B)
 *   6. Généalogie CTE récursive (upstream + downstream + isolation tenant)
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const API_KEY = process.env.API_KEY;
const ORG_ID = process.env.API_KEY_ORG_ID;

if (!API_KEY || !ORG_ID) {
  console.error('❌ API_KEY et API_KEY_ORG_ID doivent être définis dans .env');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  'x-api-key': API_KEY,
};

const log = (msg: string) => console.log(msg);
const ok = (msg: string) => console.log(`  ✅ ${msg}`);
const fail = (msg: string): never => {
  throw new Error(msg);
};

type Fixtures = {
  supplierId: string;
  productId: string;
  userId: string;
  unitCode: string;
  foreignOrgId: string;
  foreignBatchId: string;
};

async function setup(): Promise<Fixtures> {
  log('🛠  Setup fixtures...');

  await prisma.unit.upsert({
    where: { code: 'KG' },
    update: {},
    create: { code: 'KG', nom: 'Kilogrammes', factor_to_base: 1 },
  });

  await prisma.organization.upsert({
    where: { id: ORG_ID! },
    update: {},
    create: {
      id: ORG_ID!,
      name: 'E2E Security Org',
      slug: `e2e-sec-${ORG_ID!.slice(0, 8)}`,
      createdAt: new Date(),
    },
  });

  const supplierId = 'e2e-sec-supplier';
  await prisma.supplier.upsert({
    where: { id: supplierId },
    update: {},
    create: {
      id: supplierId,
      organization_id: ORG_ID!,
      nom_ferme: 'Supplier Sec',
      adresse_siege: 'addr',
    },
  });

  const productId = 'e2e-sec-product';
  await prisma.product.upsert({
    where: { id: productId },
    update: {},
    create: {
      id: productId,
      organization_id: ORG_ID!,
      nom: 'Produit Sec',
      categorie: 'Test',
      code_gtin: '3000000000079',
      duree_conservation_defaut: 30,
      seuil_alerte_stock: 1,
      unite_reference: 'KG',
    },
  });

  const userId = 'e2e-sec-user';
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId, email: 'e2e-sec@nutrichain.local', name: 'E2E Sec' },
  });

  const foreignOrgId = 'e2e-sec-foreign-org';
  await prisma.organization.upsert({
    where: { id: foreignOrgId },
    update: {},
    create: {
      id: foreignOrgId,
      name: 'Foreign Org',
      slug: 'e2e-sec-foreign',
      createdAt: new Date(),
    },
  });

  await prisma.supplier.upsert({
    where: { id: 'e2e-sec-foreign-supplier' },
    update: {},
    create: {
      id: 'e2e-sec-foreign-supplier',
      organization_id: foreignOrgId,
      nom_ferme: 'Foreign Supplier',
      adresse_siege: 'addr',
    },
  });

  await prisma.product.upsert({
    where: { id: 'e2e-sec-foreign-product' },
    update: {},
    create: {
      id: 'e2e-sec-foreign-product',
      organization_id: foreignOrgId,
      nom: 'Foreign Produit',
      categorie: 'Test',
      code_gtin: '3000000000086',
      duree_conservation_defaut: 30,
      seuil_alerte_stock: 1,
      unite_reference: 'KG',
    },
  });

  const foreignBatchId = 'e2e-sec-foreign-batch';
  await prisma.batch.upsert({
    where: { id: foreignBatchId },
    update: {},
    create: {
      id: foreignBatchId,
      organization_id: foreignOrgId,
      id_produit: 'e2e-sec-foreign-product',
      unite_code: 'KG',
      quantite_actuelle: 50,
      quantite_base: 50,
      statut: 'EN_STOCK',
      created_by: userId,
    },
  });

  ok('Fixtures prêtes');
  return { supplierId, productId, userId, unitCode: 'KG', foreignOrgId, foreignBatchId };
}

async function scenario1_apiKeySpoofing(ctx: Fixtures) {
  log('\n1️⃣  Spoofing x-org-id rejeté (Sec A)');

  const shipmentId = `E2E-SPOOF-${Date.now()}`;
  const res = await fetch(`${API_BASE}/api/logistics/receipts`, {
    method: 'POST',
    headers: { ...headers, 'x-org-id': ctx.foreignOrgId },
    body: JSON.stringify({
      id_fournisseur: ctx.supplierId,
      shipment_id: shipmentId,
      id_produit: ctx.productId,
      quantite_actuelle: 10,
      unite_code: 'KG',
      statut_controle: 'OK',
      received_by: ctx.userId,
    }),
  });

  if (res.status !== 201) {
    const body = await res.json().catch(() => null);
    fail(`POST receipt attendu 201, reçu ${res.status} : ${JSON.stringify(body)}`);
  }

  const created = await prisma.receipt.findUnique({ where: { shipment_id: shipmentId } });
  if (!created) fail('Receipt non créé en DB');
  if (created!.organization_id !== ORG_ID) {
    fail(
      `Spoofing actif : receipt créé dans ${created!.organization_id} au lieu de ${ORG_ID}`
    );
  }
  ok(`Receipt persisté dans l'org bound (${ORG_ID}) malgré x-org-id=${ctx.foreignOrgId}`);

  await prisma.batch.deleteMany({ where: { organization_id: ORG_ID!, id_produit: ctx.productId } });
  await prisma.receipt.delete({ where: { id: created!.id } });
}

async function scenario2_tenantBypass(ctx: Fixtures) {
  log('\n2️⃣  Bypass tenant supprimé sur les middlewares logistiques (Sec B)');

  const res = await fetch(`${API_BASE}/api/logistics/batches/${ctx.foreignBatchId}`, {
    headers,
  });

  if (res.status !== 404) {
    const body = await res.json().catch(() => null);
    fail(`GET batch cross-org : attendu 404, reçu ${res.status} : ${JSON.stringify(body)}`);
  }
  ok('GET /logistics/batches/<foreign-org-batch> renvoie 404 (plus de bypass)');
}

async function scenario3_publicScanFilter(ctx: Fixtures) {
  log('\n3️⃣  Public scan filtre EXPEDIE/ALERTE (Sec C)');

  const batchId = `e2e-sec-scan-${Date.now()}`;
  await prisma.batch.create({
    data: {
      id: batchId,
      organization_id: ORG_ID!,
      id_produit: ctx.productId,
      unite_code: 'KG',
      quantite_actuelle: 5,
      quantite_base: 5,
      statut: 'EN_STOCK',
      created_by: ctx.userId,
    },
  });

  const resStock = await fetch(`${API_BASE}/api/public/scan/${batchId}`);
  if (resStock.status !== 404) fail(`Lot EN_STOCK attendu 404, reçu ${resStock.status}`);
  ok('Lot EN_STOCK → 404 (non commercialisé, masqué au consommateur)');

  await prisma.batch.update({ where: { id: batchId }, data: { statut: 'EXPEDIE' } });

  const resShipped = await fetch(`${API_BASE}/api/public/scan/${batchId}`);
  if (resShipped.status !== 200) fail(`Lot EXPEDIE attendu 200, reçu ${resShipped.status}`);
  const body = (await resShipped.json()) as { data: { lot: Record<string, unknown> } };
  if (body.data.lot.organization_id) fail('Public scan expose organization_id (fuite)');
  if (body.data.lot.quantite_actuelle) fail('Public scan expose quantite_actuelle (fuite)');
  ok(`Lot EXPEDIE → 200 avec payload limité (statut: ${body.data.lot.statut_sanitaire})`);

  await prisma.batch.delete({ where: { id: batchId } });
}

async function scenario4_wormChain() {
  log('\n4️⃣  Chaîne WORM recompute exacte (WORM A)');

  const sentinelOrgId = `e2e-sec-worm-${Date.now()}`;
  await prisma.organization.create({
    data: {
      id: sentinelOrgId,
      name: 'WORM Sentinel',
      slug: `e2e-worm-${Date.now()}`,
      createdAt: new Date(),
    },
  });

  for (let i = 1; i <= 3; i++) {
    await auditService.logAction({
      organizationId: sentinelOrgId,
      userId: 'system',
      action: `E2E_TEST_${i}`,
      entity: 'Sentinel',
      entityId: String(i),
      newValue: { step: i },
    });
  }

  const logs = await prisma.audit_Log.findMany({
    where: { organization_id: sentinelOrgId },
    orderBy: { id: 'asc' },
  });

  if (logs.length !== 3) fail(`Attendu 3 logs, trouvé ${logs.length}`);

  let prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
  for (const row of logs) {
    const recomputed = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          organizationId: row.organization_id,
          userId: row.id_user || 'system',
          action: row.action,
          entity: row.entity,
          entityId: row.entity_id,
          oldValue: row.ancienne_valeur,
          newValue: row.nouvelle_valeur,
          prevHash: row.prev_hash,
          timestamp: row.horodatage.toISOString(),
        })
      )
      .digest('hex');

    if (recomputed !== row.signature_hash) {
      fail(`Log ${row.id} : hash recomputé ne matche pas. Chaîne brisée.`);
    }
    if (row.prev_hash !== prevHash) {
      fail(`Log ${row.id} : prev_hash incorrect (chaînage cassé)`);
    }
    prevHash = row.signature_hash;
  }
  ok(`3 logs WORM séquentiels, chaîne et hash recomputables`);

  await prisma.audit_Log.deleteMany({ where: { organization_id: sentinelOrgId } });
  await prisma.organization.delete({ where: { id: sentinelOrgId } });
}

async function scenario5_auditRestrict() {
  log('\n5️⃣  Audit_Log onDelete: Restrict (WORM B)');

  const sentinelOrgId = `e2e-sec-restrict-${Date.now()}`;
  await prisma.organization.create({
    data: {
      id: sentinelOrgId,
      name: 'Restrict Sentinel',
      slug: `e2e-restrict-${Date.now()}`,
      createdAt: new Date(),
    },
  });

  await auditService.logAction({
    organizationId: sentinelOrgId,
    userId: 'system',
    action: 'E2E_RESTRICT_TEST',
    entity: 'Sentinel',
    entityId: '0',
    newValue: { check: 'restrict' },
  });

  let blocked = false;
  try {
    await prisma.organization.delete({ where: { id: sentinelOrgId } });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('P2003') || msg.toLowerCase().includes('foreign key')) {
      blocked = true;
    } else {
      throw err;
    }
  }

  if (!blocked) {
    await prisma.audit_Log.deleteMany({ where: { organization_id: sentinelOrgId } });
    await prisma.organization.delete({ where: { id: sentinelOrgId } });
    fail('DELETE Organization avec audit_log a réussi (WORM violé !)');
  }
  ok('DELETE Organization avec audit_log bloqué par foreign key (P2003)');

  await prisma.audit_Log.deleteMany({ where: { organization_id: sentinelOrgId } });
  await prisma.organization.delete({ where: { id: sentinelOrgId } });
}

async function scenario6_genealogyCte(ctx: Fixtures) {
  log('\n6️⃣  Généalogie via CTE récursive (upstream + downstream + isolation tenant)');

  const stamp = Date.now();
  const productMilkId = `e2e-gen-milk-${stamp}`;
  const productPasteurizedId = `e2e-gen-pasteur-${stamp}`;
  const productYogurtId = `e2e-gen-yogurt-${stamp}`;
  const batchAId = `e2e-gen-batch-A-${stamp}`;
  const batchBId = `e2e-gen-batch-B-${stamp}`;
  const batchCId = `e2e-gen-batch-C-${stamp}`;
  const materialId = `e2e-gen-equipment-${stamp}`;
  const locationId = `e2e-gen-location-${stamp}`;
  const transformationT1Id = `e2e-gen-trans-T1-${stamp}`;
  const transformationT2Id = `e2e-gen-trans-T2-${stamp}`;

  try {
    await prisma.location.create({
      data: {
        id: locationId,
        organization_id: ORG_ID!,
        nom: 'Atelier E2E',
        type: 'PRODUCTION',
      },
    });
    await prisma.equipment.create({
      data: {
        id: materialId,
        organization_id: ORG_ID!,
        nom: 'Cuve E2E',
        type: 'CUVE',
        id_lieu: locationId,
      },
    });

    for (const [id, nom] of [
      [productMilkId, 'Lait cru E2E'],
      [productPasteurizedId, 'Lait pasteurisé E2E'],
      [productYogurtId, 'Yaourt E2E'],
    ] as const) {
      await prisma.product.create({
        data: {
          id,
          organization_id: ORG_ID!,
          nom,
          categorie: 'Test',
          code_gtin: '3000000000093',
          duree_conservation_defaut: 30,
          seuil_alerte_stock: 1,
          unite_reference: 'KG',
        },
      });
    }

    await prisma.batch.create({
      data: {
        id: batchAId,
        organization_id: ORG_ID!,
        id_produit: productMilkId,
        unite_code: 'KG',
        quantite_actuelle: 100,
        quantite_base: 100,
        statut: 'EN_STOCK',
        created_by: ctx.userId,
      },
    });

    const buildIntermediateBatch = async (id: string, productId: string) => {
      await prisma.batch.create({
        data: {
          id,
          organization_id: ORG_ID!,
          id_produit: productId,
          unite_code: 'KG',
          quantite_actuelle: 50,
          quantite_base: 50,
          statut: 'EN_STOCK',
          created_by: ctx.userId,
        },
      });
    };

    await buildIntermediateBatch(batchBId, productPasteurizedId);
    await buildIntermediateBatch(batchCId, productYogurtId);

    const buildTransformation = async (
      id: string,
      childBatchId: string,
      childProductId: string,
      parentBatchId: string
    ) => {
      await prisma.transformation.create({
        data: {
          id,
          id_lot_enfant: childBatchId,
          id_produit_fini: childProductId,
          id_user: ctx.userId,
          id_materiel: materialId,
          statut: 'TERMINE',
        },
      });
      await prisma.transformationComposition.create({
        data: {
          id_transformation: id,
          id_lot_parent: parentBatchId,
          quantite_prelevee: 50,
          unite: 'KG',
          lot_parent_epuise: false,
        },
      });
    };

    await buildTransformation(transformationT1Id, batchBId, productPasteurizedId, batchAId);
    await buildTransformation(transformationT2Id, batchCId, productYogurtId, batchBId);

    const ancestors = await genealogyService.getUpstream(batchCId, ORG_ID!);
    const ancestorIds = ancestors.map((a) => a.id).sort();
    const expectedAncestors = [batchAId, batchBId].sort();
    if (JSON.stringify(ancestorIds) !== JSON.stringify(expectedAncestors)) {
      fail(
        `getUpstream(C) attendu [A, B], reçu [${ancestorIds.join(', ')}]`
      );
    }
    ok('getUpstream(yaourt) → [lait pasteurisé, lait cru] (2 niveaux)');

    const descendants = await genealogyService.getDownstream(batchAId, ORG_ID!);
    const descendantIds = descendants.map((d) => d.id).sort();
    const expectedDescendants = [batchBId, batchCId].sort();
    if (JSON.stringify(descendantIds) !== JSON.stringify(expectedDescendants)) {
      fail(
        `getDownstream(A) attendu [B, C], reçu [${descendantIds.join(', ')}]`
      );
    }
    ok('getDownstream(lait cru) → [lait pasteurisé, yaourt] (2 niveaux)');

    const isolated = await genealogyService.getUpstream(batchCId, ctx.foreignOrgId);
    if (isolated.length !== 0) {
      fail(
        `Isolation tenant cassée : getUpstream avec foreignOrgId a retourné ${isolated.length} résultats au lieu de 0`
      );
    }
    ok(`getUpstream avec mauvaise org → [] (isolation tenant respectée)`);
  } finally {
    await prisma.transformationComposition.deleteMany({
      where: { id_transformation: { in: [transformationT1Id, transformationT2Id] } },
    });
    await prisma.transformation.deleteMany({
      where: { id: { in: [transformationT1Id, transformationT2Id] } },
    });
    await prisma.batch.deleteMany({
      where: { id: { in: [batchAId, batchBId, batchCId] } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: [productMilkId, productPasteurizedId, productYogurtId] } },
    });
    await prisma.equipment.deleteMany({ where: { id: materialId } });
    await prisma.location.deleteMany({ where: { id: locationId } });
  }
}

async function cleanup(ctx: Fixtures) {
  log('\n🧹 Cleanup...');
  await prisma.batch.deleteMany({ where: { organization_id: ctx.foreignOrgId } });
  await prisma.product.deleteMany({ where: { organization_id: ctx.foreignOrgId } });
  await prisma.supplier.deleteMany({ where: { organization_id: ctx.foreignOrgId } });
  await prisma.organization.delete({ where: { id: ctx.foreignOrgId } });
  ok('Org étrangère et ses ressources supprimées');
}

async function main() {
  try {
    const ctx = await setup();
    await scenario1_apiKeySpoofing(ctx);
    await scenario2_tenantBypass(ctx);
    await scenario3_publicScanFilter(ctx);
    await scenario4_wormChain();
    await scenario5_auditRestrict();
    await scenario6_genealogyCte(ctx);
    await cleanup(ctx);
    console.log('\n🎉 TOUS LES SCÉNARIOS E2E SÉCURITÉ ONT PASSÉ');
  } catch (err) {
    console.error('\n❌ ÉCHEC E2E SÉCURITÉ :', (err as Error).message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
