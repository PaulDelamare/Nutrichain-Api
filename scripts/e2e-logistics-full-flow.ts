import { prisma } from '../src/shared/configs/prismaClient.config';

/**
 * NUTRICHAIN - E2E LOGISTICS FULL FLOW
 * Ce script valide le cycle de vie complet d'un produit en logistique :
 * 1. Réception d'une matière première (création automatique d'un lot)
 * 2. Vérification de la création du lot et de ses métadonnées
 * 3. Expédition partielle de ce lot avec scan SSCC automatique
 * 4. Validation de la déduction de stock et de la traçabilité
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || 'E2E_TEST_KEY';
const ORG_ID = 'usine-laitiere-paris';

async function setup() {
  console.log('--- 🛠 Setup des données de test ---');
  
  // S'assurer que l'organisation existe
  await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: { 
      id: ORG_ID, 
      name: 'Usine Laitière Test', 
      slug: 'usine-test',
      createdAt: new Date() 
    },
  });

  // S'assurer que les unités existent
  await prisma.unit.upsert({
    where: { code: 'KG' },
    update: {},
    create: { code: 'KG', nom: 'Kilogrammes', factor_to_base: 1 },
  });

  // S'assurer qu'un fournisseur existe
  const supplierId = '123e4567-e89b-12d3-a456-426614174000';
  await prisma.supplier.upsert({
    where: { id: supplierId },
    update: {},
    create: { 
      id: supplierId, 
      organization_id: ORG_ID,
      nom_ferme: 'Ferme E2E', 
      adresse_siege: 'Champ Test 1' 
    },
  });

  // S'assurer qu'un produit existe
  const productId = '123e4567-e89b-12d3-a456-426614174001';
  await prisma.product.upsert({
    where: { id: productId },
    update: {},
    create: {
      id: productId,
      organization_id: ORG_ID,
      nom: 'Lait Cru E2E',
      categorie: 'Matière Première',
      duree_conservation_defaut: 5,
      seuil_alerte_stock: 10,
      unite_reference: 'KG',
    },
  });

  // S'assurer qu'un utilisateur existe pour le signalement
  const userId = '123e4567-e89b-12d3-a456-426614174099';
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId, email: 'e2e@nutrichain.local', name: 'Robot E2E' },
  });

  // S'assurer qu'un client existe (pour l'expédition)
  const clientId = '123e4567-e89b-12d3-a456-426614174002';
  await prisma.customer.upsert({
    where: { id: clientId },
    update: {},
    create: { 
      id: clientId, 
      organization_id: ORG_ID,
      nom_enseigne: 'Fromagerie E2E',
      adresse_livraison: '12 rue de la Fromagerie, Paris'
    },
  });

  return { supplierId, productId, userId, clientId };
}

async function runFlow() {
  const { supplierId, productId, userId, clientId } = await setup();
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
  };

  console.log('\n--- 🚚 Étape 1 : Réception de 100kg de Lait ---');
  const receiptBatchId = `REC-${Date.now()}`;
  const receiptPayload = {
    id_fournisseur: supplierId,
    shipment_id: receiptBatchId,
    id_produit: productId,
    quantite_actuelle: 100,
    unite_code: 'KG',
    statut_controle: 'OK',
    received_by: userId,
  };

  const resReceipt = await fetch(`${API_BASE}/api/logistics/receipts`, {
    method: 'POST',
    headers,
    body: JSON.stringify(receiptPayload),
  });

  const bodyReceipt = await resReceipt.json();
  if (resReceipt.status !== 201) throw new Error(`Réception échouée: ${JSON.stringify(bodyReceipt)}`);
  
  const receiptId = bodyReceipt.data.receiptId;
  const batchId = bodyReceipt.data.batchId; // Récupère le lot créé (format simplifié retourné par le service)
  console.log(`✅ Réception créée ID: ${receiptId}`);
  console.log(`📦 Lot généré ID: ${batchId}`);

  console.log('\n--- 🔬 Étape 2 : Vérification du lot ---');
  const resBatch = await fetch(`${API_BASE}/api/logistics/batches/${batchId}`, { headers });
  const bodyBatch = await resBatch.json();
  console.log('Body Batch:', JSON.stringify(bodyBatch, null, 2));
  if (Number(bodyBatch.data.quantite_actuelle) !== 100) throw new Error(`Stock initial incorrect: ${bodyBatch.data.quantite_actuelle}`);
  console.log(`✅ Stock confirmé: ${bodyBatch.data.quantite_actuelle} ${bodyBatch.data.unite_code}`);

  console.log('\n--- 📤 Étape 3 : Expédition partielle (30kg) avec SSCC auto ---');
  const shipmentPayload = {
    id_client: clientId, 
    transporteur: 'Transports Nutri',
    destination_adresse: '12 rue de la Fromagerie, Paris',
    created_by: userId,
    date_expedition: new Date().toISOString(),
    shipment_id: 'AUTO', // Génération SSCC demandée
    lots: [
      {
        id_lot: batchId,
        quantite_expediee: 30
      }
    ]
  };

  const resShipment = await fetch(`${API_BASE}/api/logistics/shipments`, {
    method: 'POST',
    headers,
    body: JSON.stringify(shipmentPayload),
  });

  const bodyShipment = await resShipment.json();
  if (resShipment.status !== 201) throw new Error(`Expédition échouée: ${JSON.stringify(bodyShipment)}`);
  
  const sscc = bodyShipment.data.shipment.shipment_id;
  console.log(`✅ Expédition créée avec SSCC: ${sscc}`);

  console.log('\n--- 📊 Étape 4 : Vérification finale du stock ---');
  const resBatchFinal = await fetch(`${API_BASE}/api/logistics/batches/${batchId}`, { headers });
  const bodyBatchFinal = await resBatchFinal.json();
  
  const finalQty = Number(bodyBatchFinal.data.quantite_actuelle);
  console.log(`✅ Stock final: ${finalQty} KG (Attendu: 70)`);

  if (finalQty !== 70) throw new Error(`Déduction de stock incorrecte ! Reçu: ${finalQty}`);

  console.log('\n--- 🎉 TEST E2E RÉUSSI AVEC SUCCÈS ---');
}

runFlow()
  .catch((err) => {
    console.error('\n❌ ÉCHEC DU TEST E2E :', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
