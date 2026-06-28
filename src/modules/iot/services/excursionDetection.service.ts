/**
 * Logique pure de détection d'excursion de température sur une fenêtre glissante.
 *
 * Sortie de scope (par design) :
 * - Pas de DB, pas d'I/O — fonction pure, facile à tester.
 * - Le filtrage temporel (window) est fait par l'appelant via la query Mongo
 *   (`timestamp >= now - windowMinutes`). Cette fonction reçoit les points déjà filtrés.
 *
 * Règle de détection (alignée sur les pratiques industrielles cold-chain) :
 * - Il faut au moins `minPoints` points pour décider (évite l'alerte sur 1-2 spikes).
 * - Au moins `minOverThresholdRatio` des points doivent dépasser `threshold`.
 * - Comparaison STRICTE `>` : un point exactement au seuil ne compte pas comme excursion.
 */
export interface TelemetryPoint {
  timestamp: Date;
  temperature: number;
}

export interface ExcursionResult {
  isExcursion: boolean;
  ratioOverThreshold: number; // 0..1
  peakTemp: number; // température max observée (0 si aucun point)
}

const DEFAULT_MIN_POINTS = 5;
const DEFAULT_MIN_OVER_THRESHOLD_RATIO = 0.8;

export function detectExcursion(
  points: TelemetryPoint[],
  threshold: number,
  minPoints: number = DEFAULT_MIN_POINTS,
  minOverThresholdRatio: number = DEFAULT_MIN_OVER_THRESHOLD_RATIO
): ExcursionResult {
  if (points.length === 0) {
    return { isExcursion: false, ratioOverThreshold: 0, peakTemp: 0 };
  }

  const overCount = points.reduce((acc, p) => (p.temperature > threshold ? acc + 1 : acc), 0);
  const ratio = overCount / points.length;
  // Seed avec la première température observée (et non -Infinity) pour garantir
  // un peakTemp cohérent quelle que soit la distribution des valeurs.
  const peakTemp = points.reduce(
    (max, p) => (p.temperature > max ? p.temperature : max),
    points[0].temperature
  );

  if (points.length < minPoints) {
    return { isExcursion: false, ratioOverThreshold: ratio, peakTemp };
  }

  return {
    isExcursion: ratio >= minOverThresholdRatio,
    ratioOverThreshold: ratio,
    peakTemp,
  };
}
