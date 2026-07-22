-- Suppression de quatre tables jamais utilisees : ScrapRecord, Maintenance,
-- RecipeComposition, PerformanceStat.
--
-- Elles etaient declarees au schema et decrites dans `bdd.md` sous les noms « Gestion_Rebuts »,
-- « Nettoyage_Maintenance », « Recette_Composition » et « Performance_Stats », sans qu'aucune
-- ligne de code ne les lise ni ne les ecrive : zero occurrence dans `src/`, dans les scripts et
-- dans les seeds. Elles sont donc vides, sauf insertion manuelle sur une instance tierce ; c'est
-- verifie nul sur la base de developpement.
--
-- Une table declaree que rien n'alimente induit en erreur quiconque reprend le schema.

-- DropForeignKey
ALTER TABLE "Maintenance" DROP CONSTRAINT "Maintenance_id_materiel_fkey";

-- DropForeignKey
ALTER TABLE "Maintenance" DROP CONSTRAINT "Maintenance_id_user_fkey";

-- DropForeignKey
ALTER TABLE "Maintenance" DROP CONSTRAINT "Maintenance_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "RecipeComposition" DROP CONSTRAINT "RecipeComposition_id_produit_fini_fkey";

-- DropForeignKey
ALTER TABLE "ScrapRecord" DROP CONSTRAINT "ScrapRecord_created_by_fkey";

-- DropForeignKey
ALTER TABLE "ScrapRecord" DROP CONSTRAINT "ScrapRecord_id_lot_fkey";

-- DropForeignKey
ALTER TABLE "ScrapRecord" DROP CONSTRAINT "ScrapRecord_organization_id_fkey";

-- DropTable
DROP TABLE "Maintenance";

-- DropTable
DROP TABLE "PerformanceStat";

-- DropTable
DROP TABLE "RecipeComposition";

-- DropTable
DROP TABLE "ScrapRecord";

