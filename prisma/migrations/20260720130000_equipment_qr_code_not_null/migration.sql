-- Étiquette scannable obligatoire (issue #99).
-- Avant, un matériel sans qr_code_id le recevait via un `update` PARESSEUX sur un GET
-- (getScannableLabel) : un compte lecture seule mutait la base, sans audit. On backfill les
-- matériels legacy ici, puis on rend la colonne NOT NULL — le code est desormais toujours posé
-- à la création (createEquipment) ou par le seed, jamais sur une lecture.
UPDATE "Equipment"
SET "qr_code_id" = 'EQP-' || upper(substr(md5(random()::text || "id"), 1, 10))
WHERE "qr_code_id" IS NULL;

ALTER TABLE "Equipment" ALTER COLUMN "qr_code_id" SET NOT NULL;
