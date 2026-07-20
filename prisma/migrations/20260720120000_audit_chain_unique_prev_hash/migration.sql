-- Filet d'intégrité de la chaîne d'audit WORM (issue #67).
-- Empêche deux lignes d'une même organisation de chaîner sur le même prev_hash (fork) :
-- un genesis unique par org (prev_hash constant), puis chaînage 1:1.
--
-- Pré-requis : la chaîne doit être saine. En cas d'échec de cette migration, une chaîne déjà
-- forkée existe ; l'identifier AVANT de rejouer avec :
--   SELECT organization_id, prev_hash, count(*) FROM "Audit_Log"
--   GROUP BY 1, 2 HAVING count(*) > 1;
CREATE UNIQUE INDEX "Audit_Log_organization_id_prev_hash_key" ON "Audit_Log"("organization_id", "prev_hash");
