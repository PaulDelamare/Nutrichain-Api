-- AlterTable
ALTER TABLE "Logistic_Unit" ADD COLUMN     "contenu_a_l_ouverture" JSONB,
ADD COLUMN     "opened_at" TIMESTAMP(3),
ADD COLUMN     "opened_by" TEXT;

-- AddForeignKey
ALTER TABLE "Logistic_Unit" ADD CONSTRAINT "Logistic_Unit_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Une palette ouverte a forcement un auteur : « ouverte par personne » n'est pas un etat
-- auditable. La contrainte est en base parce que rien dans le type Prisma ne lie les deux
-- colonnes nullables entre elles.
ALTER TABLE "Logistic_Unit"
  ADD CONSTRAINT "Logistic_Unit_ouverture_complete"
  CHECK (("opened_at" IS NULL) = ("opened_by" IS NULL));
