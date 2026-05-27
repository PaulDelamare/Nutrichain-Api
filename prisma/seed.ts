import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { auth } from '../src/modules/identity/auth.config';
import { auditService } from '../src/shared/utils/audit/audit.service';
import { logger } from '../src/shared/utils/logger/logger';

const prisma = new PrismaClient();

const DEMO_EMAIL = process.env.SEED_DEMO_EMAIL ?? 'nutrichain@test.fr';
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'NutriChain123!';
const DEMO_NAME = process.env.SEED_DEMO_NAME ?? 'NutriChain Demo';

async function ensureDemoUser() {
	const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });

	if (existing) {
		logger.info(`Compte démo déjà présent : ${DEMO_EMAIL}`);
		return existing;
	}

	const userCount = await prisma.user.count();

	if (userCount > 0) {
		logger.warn(
			`Impossible de créer ${DEMO_EMAIL} : des utilisateurs existent déjà. Utilise une invitation ou vide la base.`
		);
		return null;
	}

	await auth.api.signUpEmail({
		body: {
			email: DEMO_EMAIL,
			password: DEMO_PASSWORD,
			name: DEMO_NAME
		}
	});

	const user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
	logger.info(`Compte démo créé : ${DEMO_EMAIL}`);
	return user;
}

async function getActiveOrgId(userId: string): Promise<string> {
	const member = await prisma.member.findFirst({
		where: { userId },
		include: { organization: true }
	});

	if (!member) {
		throw new Error('Organisation introuvable pour le compte démo.');
	}

	return member.organizationId;
}

async function seedCatalog(orgId: string, userId: string) {
	await prisma.unit.createMany({
		data: [
			{ code: 'L', nom: 'Litres', factor_to_base: 1 },
			{ code: 'kg', nom: 'Kilogrammes', factor_to_base: 1 },
			{ code: 'U', nom: 'Unités', factor_to_base: 1 }
		],
		skipDuplicates: true
	});

	const yaourt = await prisma.product.upsert({
		where: { id: 'seed-produit-yaourt' },
		update: {},
		create: {
			id: 'seed-produit-yaourt',
			organization_id: orgId,
			nom: 'Yaourt nature bio 4x125g',
			code_gtin: '3560078891234',
			categorie: 'Produit laitier',
			duree_conservation_defaut: 30,
			seuil_alerte_stock: 500,
			unite_reference: 'U'
		}
	});

	const emmental = await prisma.product.upsert({
		where: { id: 'seed-produit-emmental' },
		update: {},
		create: {
			id: 'seed-produit-emmental',
			organization_id: orgId,
			nom: 'Emmental tranché',
			code_gtin: '3560078456789',
			categorie: 'Produit laitier',
			duree_conservation_defaut: 60,
			seuil_alerte_stock: 200,
			unite_reference: 'kg'
		}
	});

	const salade = await prisma.product.upsert({
		where: { id: 'seed-produit-salade' },
		update: {},
		create: {
			id: 'seed-produit-salade',
			organization_id: orgId,
			nom: 'Salade barquette',
			code_gtin: '3560078123456',
			categorie: 'Frais',
			duree_conservation_defaut: 7,
			seuil_alerte_stock: 100,
			unite_reference: 'U'
		}
	});

	await prisma.batch.upsert({
		where: { id: 'seed-lot-yaourt' },
		update: {},
		create: {
			id: 'seed-lot-yaourt',
			organization_id: orgId,
			id_produit: yaourt.id,
			quantite_actuelle: 2400,
			unite_code: 'U',
			quantite_base: 2400,
			date_peremption: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
			statut: 'EN_STOCK',
			created_by: userId
		}
	});

	await prisma.batch.upsert({
		where: { id: 'seed-lot-emmental' },
		update: {},
		create: {
			id: 'seed-lot-emmental',
			organization_id: orgId,
			id_produit: emmental.id,
			quantite_actuelle: 120,
			unite_code: 'kg',
			quantite_base: 120,
			date_peremption: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
			statut: 'SURVEILLANCE',
			created_by: userId
		}
	});

	await prisma.batch.upsert({
		where: { id: 'seed-lot-salade' },
		update: {},
		create: {
			id: 'seed-lot-salade',
			organization_id: orgId,
			id_produit: salade.id,
			quantite_actuelle: 80,
			unite_code: 'U',
			quantite_base: 80,
			date_peremption: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
			statut: 'QUARANTAINE',
			created_by: userId
		}
	});

	await prisma.supplier.upsert({
		where: { id: 'seed-fournisseur-bretagne' },
		update: {},
		create: {
			id: 'seed-fournisseur-bretagne',
			organization_id: orgId,
			nom_ferme: 'Ferme Les Aubépines',
			adresse_siege: 'Bretagne Nord'
		}
	});

	logger.info('Catalogue et lots seedés.');
}

async function seedOperationalData(orgId: string, userId: string) {
	const lieu = await prisma.location.upsert({
		where: { id: 'seed-lieu-rennes' },
		update: {},
		create: {
			id: 'seed-lieu-rennes',
			organization_id: orgId,
			nom: 'Entrepôt Rennes',
			type: 'ENTREPOT',
			description: 'Site Bretagne Nord'
		}
	});

	const lieuLoire = await prisma.location.upsert({
		where: { id: 'seed-lieu-loire' },
		update: {},
		create: {
			id: 'seed-lieu-loire',
			organization_id: orgId,
			nom: 'Plateforme Loire',
			type: 'EXPEDITION'
		}
	});

	await prisma.equipment.upsert({
		where: { id: 'seed-equip-froid-3' },
		update: { temp_actuelle: 6.8, statut: 'ALERTE' },
		create: {
			id: 'seed-equip-froid-3',
			organization_id: orgId,
			nom: 'Chambre froide 3',
			type: 'FROID',
			id_lieu: lieu.id,
			temp_actuelle: 6.8,
			temp_seuil_max: 6.0,
			statut: 'ALERTE'
		}
	});

	await prisma.equipment.upsert({
		where: { id: 'seed-equip-quai-b' },
		update: { temp_actuelle: 9.2, statut: 'CRITIQUE' },
		create: {
			id: 'seed-equip-quai-b',
			organization_id: orgId,
			nom: 'Quai B — expédition',
			type: 'FROID',
			id_lieu: lieuLoire.id,
			temp_actuelle: 9.2,
			temp_seuil_max: 8.0,
			statut: 'CRITIQUE'
		}
	});

	await prisma.batch.update({
		where: { id: 'seed-lot-yaourt' },
		data: { id_materiel_actuel: 'seed-equip-froid-3' }
	});

	await prisma.alert.deleteMany({
		where: {
			id: {
				in: ['seed-alert-froid-1', 'seed-alert-froid-2', 'seed-alert-rappel-yaourt']
			}
		}
	});

	await prisma.alert.createMany({
		data: [
			{
				id: 'seed-alert-froid-1',
				organization_id: orgId,
				type: 'FROID',
				niveau_gravite: 'CRITIQUE',
				message: 'Dépassement > 8 °C sur ligne expédition Loire — équipe terrain notifiée.',
				id_materiel: 'seed-equip-quai-b',
				statut: 'ACTIVE'
			},
			{
				id: 'seed-alert-froid-2',
				organization_id: orgId,
				type: 'FROID',
				niveau_gravite: 'MOYENNE',
				message: 'Température limite chambre froide 3',
				id_materiel: 'seed-equip-froid-3',
				statut: 'ACTIVE'
			},
			{
				id: 'seed-alert-rappel-yaourt',
				organization_id: orgId,
				type: 'RAPPEL',
				niveau_gravite: 'HAUTE',
				message: 'Rappel produit — Yaourt nature bio (lots seed)',
				related_entity: 'batch',
				related_id: 'seed-lot-yaourt',
				statut: 'ACTIVE'
			}
		]
	});

	await prisma.qualityControl.upsert({
		where: { id: 'seed-qc-salade' },
		update: {},
		create: {
			id: 'seed-qc-salade',
			organization_id: orgId,
			id_lot: 'seed-lot-salade',
			type_test: 'Microbiologie',
			resultat: 'NON_CONFORME',
			id_user_labo: userId,
			date_test: new Date(),
			notes: 'Flore totale hors spécification'
		}
	});

	await prisma.qualityControl.upsert({
		where: { id: 'seed-qc-emmental' },
		update: {},
		create: {
			id: 'seed-qc-emmental',
			organization_id: orgId,
			id_lot: 'seed-lot-emmental',
			type_test: 'Étiquetage',
			resultat: 'EN_COURS',
			id_user_labo: userId,
			date_test: new Date(),
			notes: 'Vérification GTIN en cours'
		}
	});

	const movementTypes = [
		{ lotId: 'seed-lot-yaourt', type: 'RECEPTION', qty: 2400 },
		{ lotId: 'seed-lot-emmental', type: 'RECEPTION', qty: 120 },
		{ lotId: 'seed-lot-salade', type: 'QUARANTAINE', qty: 80 }
	] as const;

	for (const m of movementTypes) {
		const existing = await prisma.batch_Mouvement.findFirst({
			where: { id_lot: m.lotId, type_action: m.type }
		});
		if (!existing) {
			await prisma.batch_Mouvement.create({
				data: {
					id_lot: m.lotId,
					type_action: m.type,
					quantite: m.qty,
					unite: m.lotId === 'seed-lot-emmental' ? 'kg' : 'U',
					id_user: userId,
					metadata: { source: 'seed' }
				}
			});
		}
	}

	const customer = await prisma.customer.upsert({
		where: { id: 'seed-client-carrefour' },
		update: {},
		create: {
			id: 'seed-client-carrefour',
			organization_id: orgId,
			nom_enseigne: 'Carrefour Ouest',
			adresse_livraison: '24 magasins · 3 RDC',
			contact_urgence: '0800 00 00 00'
		}
	});

	await prisma.shipment.upsert({
		where: { id: 'seed-shipment-1' },
		update: {},
		create: {
			id: 'seed-shipment-1',
			organization_id: orgId,
			id_client: customer.id,
			shipment_id: 'SHP-2025-8842',
			date_envoi: new Date(),
			transporteur: 'STEF',
			statut_livraison: 'EN_COURS',
			created_by: userId
		}
	});

	await auditService.logAction({
		organizationId: orgId,
		userId,
		action: 'CREATE',
		entity: 'batch',
		entityId: 'seed-lot-yaourt',
		newValue: { statut: 'EN_STOCK' }
	});

	await auditService.logAction({
		organizationId: orgId,
		userId,
		action: 'SYNC',
		entity: 'integration',
		entityId: 'WMS',
		newValue: { status: 'OK', latency_ms: 120 }
	});

	logger.info('Données opérationnelles seedées (alertes, qualité, audit, clients).');
}

async function main() {
	logger.info('🌱 Démarrage du seed NutriChain…');

	const demoUser = await ensureDemoUser();

	if (!demoUser) {
		logger.info('Seed catalogue ignoré (pas de compte démo).');
		return;
	}

	const orgId = await getActiveOrgId(demoUser.id);

	await prisma.session.updateMany({
		where: { userId: demoUser.id },
		data: { activeOrganizationId: orgId }
	});

	await seedCatalog(orgId, demoUser.id);
	await seedOperationalData(orgId, demoUser.id);

	logger.info('✅ Seed terminé.');
	logger.info(`   Email    : ${DEMO_EMAIL}`);
	logger.info(`   Password : ${DEMO_PASSWORD}`);
}

main()
	.catch((e) => {
		console.error(e);
		logger.error('❌ Seed échoué:', e);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
