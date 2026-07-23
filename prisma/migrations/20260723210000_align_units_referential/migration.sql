-- Référentiel d'unités : une seule source de vérité (src/shared/constants/units.constants.ts).
-- La table Unit était peuplée de `L`, `kg`, `U` tandis que la validation attendait
-- `KG, G, L, ML, UNIT, PALLET, BOX` : une réception en `KG` violait la FK Batch.unite_code (500),
-- une transformation en `ML` était refusée. On aligne la table ET les données existantes sur la
-- casse canonique MAJUSCULE, et on complète les unités manquantes.

-- 1. Compléter le référentiel (idempotent).
INSERT INTO "Unit" (code, nom, factor_to_base) VALUES
  ('KG', 'Kilogrammes', 1),
  ('G', 'Grammes', 1),
  ('L', 'Litres', 1),
  ('ML', 'Millilitres', 1),
  ('UNIT', 'Unités', 1),
  ('PALLET', 'Palettes', 1),
  ('BOX', 'Cartons', 1)
ON CONFLICT (code) DO NOTHING;

-- 2. Remapper les données existantes AVANT le DELETE, pour ne pas violer la FK Batch.unite_code.
--    Défensif : UPPER couvre toute casse (kg, Kg), et l'ancien 'U' devient 'UNIT'. Les cibles
--    existent toutes depuis l'étape 1. Batch.unite_code est la seule FK ; les 4 autres colonnes
--    sont des String libres, remappées pour la cohérence d'affichage.
UPDATE "Batch"                     SET unite_code      = CASE WHEN UPPER(unite_code)      = 'U' THEN 'UNIT' ELSE UPPER(unite_code)      END;
UPDATE "Product"                   SET unite_reference = CASE WHEN UPPER(unite_reference) = 'U' THEN 'UNIT' ELSE UPPER(unite_reference) END;
UPDATE "TransformationComposition" SET unite           = CASE WHEN UPPER(unite)           = 'U' THEN 'UNIT' ELSE UPPER(unite)           END;
UPDATE "Liaison_Shipment"          SET unite           = CASE WHEN UPPER(unite)           = 'U' THEN 'UNIT' ELSE UPPER(unite)           END;
UPDATE "Batch_Mouvement"           SET unite           = CASE WHEN UPPER(unite)           = 'U' THEN 'UNIT' ELSE UPPER(unite)           END;

-- 3. Retirer précisément les anciens codes non canoniques. Ciblé (et non `NOT IN (référentiel)`)
--    pour ne jamais supprimer un code hérité inattendu encore référencé : après l'étape 2, plus
--    aucune ligne ne pointe vers 'kg' ni 'U'.
DELETE FROM "Unit" WHERE code IN ('kg', 'U');
