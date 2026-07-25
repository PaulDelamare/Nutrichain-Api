import { TelemetryModel } from '../../src/modules/iot/models/telemetry.model';

/**
 * Attend que la fenêtre de télémétrie soit relisible AVANT de déclencher la détection.
 *
 * Deux pièges, tous deux rencontrés sur le runner CI :
 *
 * 1. **Le prédicat d'attente doit être celui de la détection.** Attendre sur une égalité exacte de
 *    `timestamp` ne prouve rien de ce que la détection verra : elle, lit une FENÊTRE
 *    (`sensor + organisation + timestamp >= maintenant - 15 min`). On attend donc sur cette
 *    requête-là, et sur le NOMBRE de points dont la détection a besoin.
 * 2. **Une attente qui abandonne en silence produit un faux diagnostic.** L'ancienne version
 *    s'arrêtait après 1 s sans rien dire ; la détection lisait une fenêtre vide et le scénario
 *    échouait sur « 1 Alert ACTIVE créée (reçu 0) » — un symptôme métier pour une cause technique.
 *    On lève désormais une erreur explicite : le message dit ce qui manque.
 *
 * La borne reste stricte (pas d'attente infinie). Elle visait la latence observée sur le runner
 * (~1 à 2 s), mais la CI a échoué deux fois sur ce même point avec une latence qui dépassait les
 * 6 s d'origine (cf. issue #215) : la marge était trop juste pour la queue de distribution réelle
 * sous charge CI, pas seulement pour le cas moyen. Relevée à 15 s.
 */
const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS = 150;
const DELAY_MS = 100;

export async function waitForDetectableWindow(
  sensorId: string,
  organizationId: string,
  expectedPoints: number
): Promise<void> {
  let seen = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    seen = await TelemetryModel.countDocuments({
      'metadata.sensor_id': sensorId,
      'metadata.organization_id': organizationId,
      timestamp: { $gte: new Date(Date.now() - WINDOW_MINUTES * 60_000) },
    });
    if (seen >= expectedPoints) return;
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  throw new Error(
    `Télémétrie non relisible : ${seen}/${expectedPoints} point(s) visible(s) pour ${sensorId} ` +
      `après ${(MAX_ATTEMPTS * DELAY_MS) / 1000} s. La détection lirait une fenêtre incomplète — ` +
      `ce n'est pas un défaut métier, c'est l'écriture qui n'est pas encore visible.`
  );
}
