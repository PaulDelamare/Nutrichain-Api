-- Séquence de numérotation des SSCC générés (issue #124).
--
-- Le serial venait de `count(expéditions de l'org) + 1` : une LECTURE, pas une réservation. Deux
-- expéditions simultanées lisaient le même compte, fabriquaient le même SSCC, et la seconde
-- mourait sur un P2002 non traduit — 500 devant le camion. Le compteur n'était pas non plus
-- monotone dès qu'un `shipment_id` saisi à la main s'intercalait.
--
-- `nextval` est hors transaction : deux appels concurrents ne peuvent pas rendre la même valeur, et
-- un rollback ne réattribue pas le numéro. Les trous que cela laisse sont sans conséquence — un
-- serial GS1 doit être unique, pas contigu.
CREATE SEQUENCE IF NOT EXISTS "sscc_serial_seq" AS BIGINT START WITH 1 INCREMENT BY 1;

-- Les SSCC déjà émis dérivent d'un compte par organisation : démarrer à 1 les régénérerait à
-- l'identique. On place la séquence au-dessus du total des expéditions existantes, qui majore le
-- compte de n'importe quelle organisation.
SELECT setval('sscc_serial_seq', GREATEST((SELECT COUNT(*) FROM "Shipment"), 1));
