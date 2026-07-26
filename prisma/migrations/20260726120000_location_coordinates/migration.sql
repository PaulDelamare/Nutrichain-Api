-- AlterTable
-- (issue #23) Coordonnées réelles du lieu. Le front n'avait aucune source et les devinait par regex
-- sur le NOM du site. Nullable : les lieux existants n'en ont pas encore, la fiche lot n'affichera
-- simplement pas de carte tant qu'elles ne sont pas renseignées.
ALTER TABLE "Location" ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "longitude" DECIMAL(9,6);
