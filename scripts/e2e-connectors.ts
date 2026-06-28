/**
 * E2E — connecteurs ERP/WMS (issue connecteurs).
 *
 * Valide contre Postgres réel, en appelant directement les services :
 *  - import CSV produit → persistance + idempotence (ré-import = update, pas de doublon)
 *  - export EPCIS → CSV avec en-tête
 *
 * Pré-requis : DB up + seed + .env (API_KEY_ORG_ID).
 * Lancement : npm run e2e:connectors
 */
import { prisma } from '../src/shared/configs/prismaClient.config';
import { productImportService } from '../src/modules/connectors/services/productImport.service';
import { customerImportService } from '../src/modules/connectors/services/customerImport.service';
import { eventExportService } from '../src/modules/connectors/services/eventExport.service';

const ORG_ID = process.env.API_KEY_ORG_ID;
if (!ORG_ID) {
  console.error('[E2E] API_KEY_ORG_ID requis dans .env');
  process.exit(1);
}

const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    failures.push(label);
    console.error(`  ❌ ${label}`);
  }
}

async function main() {
  console.log(`[E2E] Connecteurs — org ${ORG_ID}`);
  const unit = await prisma.unit.findFirst();
  if (!unit) throw new Error('aucune unité seedée');

  let customerExternalRef: string | null = null;
  const gtin = `39${Date.now().toString().slice(-11)}`; // 13 chiffres, unique par run
  const header =
    'nom,code_gtin,categorie,duree_conservation_defaut,seuil_alerte_stock,unite_reference';
  const csv = `${header}\nE2E-Connecteur,${gtin},Test,30,5,${unit.code}`;

  try {
    // 1. Import (création)
    const r1 = await productImportService.importProducts(ORG_ID!, csv);
    assert(r1.created === 1 && r1.errors === 0, `import → 1 créé (créés=${r1.created}, err=${r1.errors})`);
    const created = await prisma.product.findFirst({
      where: { organization_id: ORG_ID!, code_gtin: gtin },
    });
    assert(!!created, 'produit réellement persisté en DB');

    // 2. Ré-import (idempotent : update, pas de doublon)
    const r2 = await productImportService.importProducts(ORG_ID!, csv);
    assert(r2.updated === 1 && r2.created === 0, `ré-import → update (maj=${r2.updated}, créés=${r2.created})`);
    const count = await prisma.product.count({
      where: { organization_id: ORG_ID!, code_gtin: gtin },
    });
    assert(count === 1, `pas de doublon après ré-import (count=${count})`);

    // 3. Ligne invalide n'annule pas les valides
    const mixed = `${header}\nBon,${gtin}1,Test,30,5,${unit.code}\nMauvais,123,Test,30,5,${unit.code}`;
    const r3 = await productImportService.importProducts(ORG_ID!, mixed);
    assert(r3.created === 1 && r3.errors === 1, `succès partiel (créés=${r3.created}, err=${r3.errors})`);

    // 4. Import CLIENTS (idempotent par external_ref) — alimente Customer.email pour le rappel (#20)
    const extRef = `ERP-${Date.now()}`;
    const custHeader = 'external_ref,nom_enseigne,email,contact_urgence,adresse_livraison,notes';
    const custCsv = `${custHeader}\n${extRef},E2E-Client,e2e-client@example.com,,1 rue Test,`;

    const c1 = await customerImportService.importCustomers(ORG_ID!, custCsv);
    assert(c1.created === 1 && c1.errors === 0, `import client → 1 créé (créés=${c1.created})`);
    const cust = await prisma.customer.findFirst({
      where: { organization_id: ORG_ID!, external_ref: extRef },
    });
    assert(cust?.email === 'e2e-client@example.com', 'client persisté avec email (prêt pour notif rappel)');

    const c2 = await customerImportService.importCustomers(ORG_ID!, custCsv);
    assert(c2.updated === 1 && c2.created === 0, `ré-import client → update (maj=${c2.updated})`);
    const custCount = await prisma.customer.count({
      where: { organization_id: ORG_ID!, external_ref: extRef },
    });
    assert(custCount === 1, `pas de doublon client (count=${custCount})`);
    customerExternalRef = extRef;

    // 5. Export EPCIS → CSV
    const out = await eventExportService.exportEventsCsv(ORG_ID!);
    assert(
      out.split('\n')[0] === 'event_time,event_type,related_entity,related_id,payload',
      'export EPCIS → CSV avec en-tête exact'
    );
  } catch (err) {
    console.error('[E2E] Erreur:', err);
    failures.push(`Exception: ${(err as Error).message}`);
  } finally {
    await prisma.product.deleteMany({
      where: { organization_id: ORG_ID!, code_gtin: { in: [gtin, `${gtin}1`] } },
    });
    if (customerExternalRef) {
      await prisma.customer.deleteMany({
        where: { organization_id: ORG_ID!, external_ref: customerExternalRef },
      });
    }
    await prisma.$disconnect();
    if (failures.length) {
      console.error(`\n❌ ${failures.length} échec(s)`);
      process.exitCode = 1;
    } else {
      console.log('\n✅ Tous les scénarios E2E connecteurs sont passés.');
    }
  }
}

main();
