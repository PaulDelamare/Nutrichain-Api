-- Retirer l index simple devenu redondant sur Logistic_Unit_Content(id_lot).
--
-- La migration 20260729230000 a pose un index UNIQUE sur cette meme colonne : un index unique sert
-- deja d index de recherche. Les deux coexistaient, donc chaque palettisation payait deux ecritures
-- d index pour une seule lecture possible.

-- DropIndex
DROP INDEX IF EXISTS "Logistic_Unit_Content_id_lot_idx";
