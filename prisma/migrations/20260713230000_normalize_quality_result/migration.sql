-- Le résultat d'un contrôle qualité PILOTE désormais le statut du lot (libération ou quarantaine).
-- Il ne peut donc plus être du texte libre : la base contenait des valeurs comme
-- « NON_CONFORME — QUARANTAINE », illisibles pour la machine.
--
-- Normalisation des données existantes vers le vocabulaire unique (CONFORME | NON_CONFORME).
-- Tout ce qui commence par NON_CONFORME est une non-conformité ; le reste est laissé tel quel
-- s'il n'est pas reconnu (on ne devine pas un résultat sanitaire).
UPDATE "QualityControl"
   SET resultat = 'NON_CONFORME'
 WHERE resultat LIKE 'NON_CONFORME%';

UPDATE "QualityControl"
   SET resultat = 'CONFORME'
 WHERE resultat LIKE 'CONFORME%';
