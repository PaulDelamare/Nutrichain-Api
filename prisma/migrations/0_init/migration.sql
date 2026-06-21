-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "twoFactorEnabled" BOOLEAN DEFAULT false,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "activeOrganizationId" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "metadata" TEXT,
    "gs1_company_prefix" TEXT,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inviterId" TEXT NOT NULL,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "twoFactor" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verified" BOOLEAN DEFAULT true,

    CONSTRAINT "twoFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "code" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "factor_to_base" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "EPCIS_Event" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "event_time" TIMESTAMP(3) NOT NULL,
    "event_type" TEXT NOT NULL,
    "related_entity" TEXT NOT NULL,
    "related_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "EPCIS_Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EPCIS_Aggregation_Event" (
    "id" TEXT NOT NULL,
    "sscc" TEXT NOT NULL,
    "id_lot_enfant" TEXT NOT NULL,
    "id_lot_parent" TEXT NOT NULL,
    "event_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EPCIS_Aggregation_Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "id_lieu" TEXT NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'PRET',
    "temp_actuelle" DECIMAL(65,30),
    "temp_seuil_max" DECIMAL(65,30),
    "qr_code_id" TEXT,
    "sensor_id" TEXT,
    "last_cleaned_at" TIMESTAMP(3),

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "code_gtin" TEXT NOT NULL,
    "categorie" TEXT NOT NULL,
    "duree_conservation_defaut" INTEGER NOT NULL,
    "seuil_alerte_stock" DECIMAL(65,30) NOT NULL,
    "unite_reference" TEXT NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "id_produit" TEXT NOT NULL,
    "quantite_actuelle" DECIMAL(65,30) NOT NULL,
    "unite_code" TEXT NOT NULL,
    "quantite_base" DECIMAL(65,30) NOT NULL,
    "date_peremption" TIMESTAMP(3),
    "statut" TEXT NOT NULL DEFAULT 'EN_STOCK',
    "id_materiel_actuel" TEXT,
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transformation" (
    "id" TEXT NOT NULL,
    "id_lot_enfant" TEXT NOT NULL,
    "id_produit_fini" TEXT NOT NULL,
    "id_user" TEXT NOT NULL,
    "id_materiel" TEXT NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'EN_COURS',
    "note_technique" JSONB,
    "horodatage_debut" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "horodatage_fin" TIMESTAMP(3),
    "duration_seconds" INTEGER,

    CONSTRAINT "Transformation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransformationComposition" (
    "id_transformation" TEXT NOT NULL,
    "id_lot_parent" TEXT NOT NULL,
    "quantite_prelevee" DECIMAL(65,30) NOT NULL,
    "unite" TEXT NOT NULL,
    "lot_parent_epuise" BOOLEAN NOT NULL,
    "note" TEXT,

    CONSTRAINT "TransformationComposition_pkey" PRIMARY KEY ("id_transformation","id_lot_parent")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "niveau_gravite" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "id_materiel" TEXT,
    "related_entity" TEXT,
    "related_id" TEXT,
    "statut" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audit_Log" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "id_user" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "ancienne_valeur" JSONB,
    "nouvelle_valeur" JSONB,
    "prev_hash" CHAR(64) NOT NULL,
    "signature_hash" CHAR(64) NOT NULL,
    "horodatage" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Audit_Log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audit_Checkpoint" (
    "organization_id" TEXT NOT NULL,
    "last_id" INTEGER NOT NULL,
    "last_signature_hash" CHAR(64) NOT NULL,
    "last_row_count" INTEGER NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Audit_Checkpoint_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "ScrapRecord" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "id_lot" TEXT NOT NULL,
    "quantite_jetee" DECIMAL(65,30) NOT NULL,
    "unite" TEXT NOT NULL,
    "motif" TEXT NOT NULL,
    "date_mise_au_rebut" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "ScrapRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityControl" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "id_lot" TEXT NOT NULL,
    "type_test" TEXT NOT NULL,
    "resultat" TEXT NOT NULL,
    "id_user_labo" TEXT NOT NULL,
    "certificat_pdf" TEXT,
    "date_test" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "QualityControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Maintenance" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "id_materiel" TEXT NOT NULL,
    "id_user" TEXT NOT NULL,
    "type_action" TEXT NOT NULL,
    "produit_utilise" TEXT,
    "date_debut" TIMESTAMP(3) NOT NULL,
    "date_fin" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),

    CONSTRAINT "Maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeComposition" (
    "id" TEXT NOT NULL,
    "id_produit_fini" TEXT NOT NULL,
    "id_type_ingredient" TEXT NOT NULL,
    "quantite_theorique" DECIMAL(65,30) NOT NULL,
    "unite" TEXT NOT NULL,
    "tolerance_percent" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "RecipeComposition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "nom_ferme" TEXT NOT NULL,
    "type_produit" TEXT,
    "contact_qualite" TEXT,
    "adresse_siege" TEXT NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "id_fournisseur" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "date_reception" TIMESTAMP(3) NOT NULL,
    "temperature_camion_summary" JSONB,
    "temperature_camion_raw" JSONB,
    "statut_controle" TEXT NOT NULL,
    "received_by" TEXT NOT NULL,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "nom_enseigne" TEXT NOT NULL,
    "contact_urgence" TEXT,
    "email" TEXT,
    "adresse_livraison" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "id_client" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "date_envoi" TIMESTAMP(3) NOT NULL,
    "transporteur" TEXT NOT NULL,
    "statut_livraison" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Liaison_Shipment" (
    "id" TEXT NOT NULL,
    "id_expedition" TEXT NOT NULL,
    "id_lot" TEXT NOT NULL,
    "quantite_expediee" DECIMAL(65,30) NOT NULL,
    "unite" TEXT NOT NULL,
    "pallet_id" TEXT,

    CONSTRAINT "Liaison_Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch_Mouvement" (
    "id" SERIAL NOT NULL,
    "id_lot" TEXT NOT NULL,
    "type_action" TEXT NOT NULL,
    "quantite" DECIMAL(65,30) NOT NULL,
    "unite" TEXT NOT NULL,
    "id_transformation" TEXT,
    "id_expedition" TEXT,
    "id_user" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "Batch_Mouvement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceStat" (
    "id" SERIAL NOT NULL,
    "type_metrique" TEXT NOT NULL,
    "valeur" DECIMAL(65,30) NOT NULL,
    "id_reference" TEXT,
    "horodatage" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "client_op_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_status" TEXT NOT NULL,
    "response_payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_id_key" ON "user"("id");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");

-- CreateIndex
CREATE INDEX "member_organizationId_idx" ON "member"("organizationId");

-- CreateIndex
CREATE INDEX "member_userId_idx" ON "member"("userId");

-- CreateIndex
CREATE INDEX "invitation_organizationId_idx" ON "invitation"("organizationId");

-- CreateIndex
CREATE INDEX "invitation_email_idx" ON "invitation"("email");

-- CreateIndex
CREATE INDEX "twoFactor_secret_idx" ON "twoFactor"("secret");

-- CreateIndex
CREATE INDEX "twoFactor_userId_idx" ON "twoFactor"("userId");

-- CreateIndex
CREATE INDEX "EPCIS_Event_organization_id_idx" ON "EPCIS_Event"("organization_id");

-- CreateIndex
CREATE INDEX "EPCIS_Event_related_entity_related_id_idx" ON "EPCIS_Event"("related_entity", "related_id");

-- CreateIndex
CREATE INDEX "EPCIS_Event_event_time_idx" ON "EPCIS_Event"("event_time");

-- CreateIndex
CREATE UNIQUE INDEX "EPCIS_Aggregation_Event_sscc_key" ON "EPCIS_Aggregation_Event"("sscc");

-- CreateIndex
CREATE INDEX "EPCIS_Aggregation_Event_id_lot_enfant_idx" ON "EPCIS_Aggregation_Event"("id_lot_enfant");

-- CreateIndex
CREATE INDEX "EPCIS_Aggregation_Event_id_lot_parent_idx" ON "EPCIS_Aggregation_Event"("id_lot_parent");

-- CreateIndex
CREATE INDEX "Location_organization_id_idx" ON "Location"("organization_id");

-- CreateIndex
CREATE INDEX "Equipment_organization_id_idx" ON "Equipment"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_organization_id_sensor_id_key" ON "Equipment"("organization_id", "sensor_id");

-- CreateIndex
CREATE INDEX "Product_organization_id_idx" ON "Product"("organization_id");

-- CreateIndex
CREATE INDEX "Batch_organization_id_idx" ON "Batch"("organization_id");

-- CreateIndex
CREATE INDEX "Transformation_id_lot_enfant_idx" ON "Transformation"("id_lot_enfant");

-- CreateIndex
CREATE INDEX "TransformationComposition_id_lot_parent_idx" ON "TransformationComposition"("id_lot_parent");

-- CreateIndex
CREATE INDEX "Alert_organization_id_idx" ON "Alert"("organization_id");

-- CreateIndex
CREATE INDEX "Audit_Log_organization_id_idx" ON "Audit_Log"("organization_id");

-- CreateIndex
CREATE INDEX "Audit_Log_id_user_idx" ON "Audit_Log"("id_user");

-- CreateIndex
CREATE INDEX "Audit_Log_entity_entity_id_idx" ON "Audit_Log"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "Audit_Log_horodatage_idx" ON "Audit_Log"("horodatage");

-- CreateIndex
CREATE INDEX "Audit_Log_action_idx" ON "Audit_Log"("action");

-- CreateIndex
CREATE INDEX "Audit_Log_signature_hash_idx" ON "Audit_Log"("signature_hash");

-- CreateIndex
CREATE INDEX "ScrapRecord_organization_id_idx" ON "ScrapRecord"("organization_id");

-- CreateIndex
CREATE INDEX "QualityControl_organization_id_idx" ON "QualityControl"("organization_id");

-- CreateIndex
CREATE INDEX "Maintenance_organization_id_idx" ON "Maintenance"("organization_id");

-- CreateIndex
CREATE INDEX "Supplier_organization_id_idx" ON "Supplier"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_shipment_id_key" ON "Receipt"("shipment_id");

-- CreateIndex
CREATE INDEX "Receipt_organization_id_idx" ON "Receipt"("organization_id");

-- CreateIndex
CREATE INDEX "Customer_organization_id_idx" ON "Customer"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_shipment_id_key" ON "Shipment"("shipment_id");

-- CreateIndex
CREATE INDEX "Shipment_organization_id_idx" ON "Shipment"("organization_id");

-- CreateIndex
CREATE INDEX "IdempotencyKey_organization_id_idx" ON "IdempotencyKey"("organization_id");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expires_at_idx" ON "IdempotencyKey"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_organization_id_client_op_id_key" ON "IdempotencyKey"("organization_id", "client_op_id");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EPCIS_Event" ADD CONSTRAINT "EPCIS_Event_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_id_lieu_fkey" FOREIGN KEY ("id_lieu") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_id_produit_fkey" FOREIGN KEY ("id_produit") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_unite_code_fkey" FOREIGN KEY ("unite_code") REFERENCES "Unit"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_id_materiel_actuel_fkey" FOREIGN KEY ("id_materiel_actuel") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transformation" ADD CONSTRAINT "Transformation_id_lot_enfant_fkey" FOREIGN KEY ("id_lot_enfant") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transformation" ADD CONSTRAINT "Transformation_id_produit_fini_fkey" FOREIGN KEY ("id_produit_fini") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transformation" ADD CONSTRAINT "Transformation_id_user_fkey" FOREIGN KEY ("id_user") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transformation" ADD CONSTRAINT "Transformation_id_materiel_fkey" FOREIGN KEY ("id_materiel") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransformationComposition" ADD CONSTRAINT "TransformationComposition_id_transformation_fkey" FOREIGN KEY ("id_transformation") REFERENCES "Transformation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransformationComposition" ADD CONSTRAINT "TransformationComposition_id_lot_parent_fkey" FOREIGN KEY ("id_lot_parent") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit_Log" ADD CONSTRAINT "Audit_Log_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit_Checkpoint" ADD CONSTRAINT "Audit_Checkpoint_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapRecord" ADD CONSTRAINT "ScrapRecord_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapRecord" ADD CONSTRAINT "ScrapRecord_id_lot_fkey" FOREIGN KEY ("id_lot") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapRecord" ADD CONSTRAINT "ScrapRecord_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityControl" ADD CONSTRAINT "QualityControl_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityControl" ADD CONSTRAINT "QualityControl_id_lot_fkey" FOREIGN KEY ("id_lot") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityControl" ADD CONSTRAINT "QualityControl_id_user_labo_fkey" FOREIGN KEY ("id_user_labo") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Maintenance" ADD CONSTRAINT "Maintenance_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Maintenance" ADD CONSTRAINT "Maintenance_id_materiel_fkey" FOREIGN KEY ("id_materiel") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Maintenance" ADD CONSTRAINT "Maintenance_id_user_fkey" FOREIGN KEY ("id_user") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeComposition" ADD CONSTRAINT "RecipeComposition_id_produit_fini_fkey" FOREIGN KEY ("id_produit_fini") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_id_fournisseur_fkey" FOREIGN KEY ("id_fournisseur") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_id_client_fkey" FOREIGN KEY ("id_client") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Liaison_Shipment" ADD CONSTRAINT "Liaison_Shipment_id_expedition_fkey" FOREIGN KEY ("id_expedition") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Liaison_Shipment" ADD CONSTRAINT "Liaison_Shipment_id_lot_fkey" FOREIGN KEY ("id_lot") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch_Mouvement" ADD CONSTRAINT "Batch_Mouvement_id_lot_fkey" FOREIGN KEY ("id_lot") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch_Mouvement" ADD CONSTRAINT "Batch_Mouvement_id_transformation_fkey" FOREIGN KEY ("id_transformation") REFERENCES "Transformation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch_Mouvement" ADD CONSTRAINT "Batch_Mouvement_id_expedition_fkey" FOREIGN KEY ("id_expedition") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch_Mouvement" ADD CONSTRAINT "Batch_Mouvement_id_user_fkey" FOREIGN KEY ("id_user") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

