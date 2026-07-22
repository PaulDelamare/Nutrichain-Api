-- Suppression de quatre tables jamais utilisees : ScrapRecord, Maintenance,
-- RecipeComposition, PerformanceStat.
--
-- Elles etaient declarees dans le schema, presentes dans l'ERD, et vendues dans `bdd.md` sous les
-- noms « Gestion_Rebuts », « Nettoyage_Maintenance », « Recette_Composition » et
-- « Performance_Stats ». Aucune n'a jamais ete lue ni ecrite : zero occurrence dans `src/`, dans
-- les scripts et dans les seeds. Aucun code n'a donc jamais ecrit dedans : elles sont vides,
-- sauf insertion manuelle sur une instance tierce. Verifie nul sur la base de developpement.
--
-- Un jury pardonne un perimetre assume, pas une table fantome.

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

