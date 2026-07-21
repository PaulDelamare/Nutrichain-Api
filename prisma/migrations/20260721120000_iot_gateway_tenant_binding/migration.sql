-- Liaison clé IoT ↔ organisation (issue #93).
--
-- La clé capteur ne résout plus son tenant depuis `API_KEY_ORG_ID` (variable d'env unique) mais
-- depuis cette table : une passerelle = une organisation. Les clés sont stockées hachées (SHA-256),
-- révocables via `revoked_at`.
CREATE TABLE "IotGateway" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IotGateway_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IotGateway_key_hash_key" ON "IotGateway"("key_hash");

CREATE INDEX "IotGateway_organization_id_idx" ON "IotGateway"("organization_id");

ALTER TABLE "IotGateway" ADD CONSTRAINT "IotGateway_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
