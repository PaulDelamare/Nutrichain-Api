-- AlterTable
-- (issue #57) Pic et seuil de l'excursion en champs structurés sur l'alerte, plutôt que
-- noyés dans le `message`. Nullable : les alertes non-TEMP_EXCURSION (et l'existant) n'en ont pas.
ALTER TABLE "Alert" ADD COLUMN     "peak_temp" DECIMAL(65,30),
ADD COLUMN     "temp_seuil" DECIMAL(65,30);
