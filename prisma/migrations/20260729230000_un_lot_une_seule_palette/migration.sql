-- Un lot est sur AU PLUS UNE palette.
--
-- La cle primaire composite (id_unite_logistique, id_lot) autorisait le meme lot sur deux
-- palettes. Or la position est portee par le lot, en une seule valeur : palette A rangee au
-- frigo 1 puis palette B au frigo 2, et le lot declarait etre au frigo 2 alors qu'une partie
-- etait au frigo 1. Une excursion sur le frigo 1 ne l'aurait alors PAS mis en quarantaine —
-- un faux negatif sanitaire, silencieux.
--
-- La contrainte est posee en base et pas seulement dans le service : deux palettisations
-- simultanees passeraient toutes les deux une verification applicative.

-- CreateIndex
CREATE UNIQUE INDEX "Logistic_Unit_Content_id_lot_key" ON "Logistic_Unit_Content"("id_lot");

