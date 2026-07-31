-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "date_livraison" TIMESTAMP(3),
ADD COLUMN     "delivered_by" TEXT,
ADD COLUMN     "delivered_by_label" TEXT;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_delivered_by_fkey" FOREIGN KEY ("delivered_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reprise des lignes existantes.
--
-- `EN_TRANSIT` s'etait glisse dans le seed de demonstration sans que rien ne le voie : ni
-- `prisma/` ni `scripts/` ne sont couverts par `tsconfig.check.json`. Les lignes deja semees
-- seraient restees inconfirmables a vie, refusees par la garde « statut != EN_ROUTE ».
UPDATE "Shipment" SET "statut_livraison" = 'EN_ROUTE' WHERE "statut_livraison" NOT IN ('EN_ROUTE', 'LIVRE');

-- Une expedition deja marquee LIVRE avant cette migration n'a ni date ni auteur : on la retablit
-- en transit plutot que d'affirmer une livraison qu'on ne peut ni dater ni attribuer. Mieux vaut
-- une information absente qu'une information inventee.
UPDATE "Shipment" SET "statut_livraison" = 'EN_ROUTE'
  WHERE "statut_livraison" = 'LIVRE' AND "date_livraison" IS NULL;

-- La seule garde qui morde reellement sur le vocabulaire : une constante TypeScript ne couvre ni
-- le seed ni les scripts, et c'est precisement par la qu'une valeur hors liste est entree.
ALTER TABLE "Shipment"
  ADD CONSTRAINT "Shipment_statut_livraison_connu"
  CHECK ("statut_livraison" IN ('EN_ROUTE', 'LIVRE'));

-- Coherence des trois colonnes de livraison, ensemble : « LIVRE » exige une date, une date exige
-- un auteur (interne OU externe), et l'inverse. Le CHECK binaire date/auteur que j'avais d'abord
-- ecrit laissait passer « LIVRE, date nulle » — l'etat exact que produisait le seed.
ALTER TABLE "Shipment"
  ADD CONSTRAINT "Shipment_livraison_coherente"
  CHECK (
    ("statut_livraison" = 'LIVRE' AND "date_livraison" IS NOT NULL
      AND ("delivered_by" IS NOT NULL OR "delivered_by_label" IS NOT NULL))
    OR
    ("statut_livraison" <> 'LIVRE' AND "date_livraison" IS NULL
      AND "delivered_by" IS NULL AND "delivered_by_label" IS NULL)
  );
