import { describe, it, expect } from 'vitest';
import { detectExcursion } from './excursionDetection.service';

const buildPoint = (minutesAgo: number, temperature: number) => ({
  timestamp: new Date(Date.now() - minutesAgo * 60_000),
  temperature,
});

describe('detectExcursion', () => {
  it('tableau vide → isExcursion=false', () => {
    const result = detectExcursion([], 4);
    expect(result.isExcursion).toBe(false);
    expect(result.ratioOverThreshold).toBe(0);
  });

  it('points.length < minPoints (4 points) → false (insuffisant)', () => {
    const points = [buildPoint(1, 8), buildPoint(2, 8), buildPoint(3, 8), buildPoint(4, 8)];
    const result = detectExcursion(points, 4);
    expect(result.isExcursion).toBe(false);
  });

  it('5 points tous au-dessus du seuil → isExcursion=true, ratio=1.0', () => {
    const points = Array.from({ length: 5 }, (_, i) => buildPoint(i + 1, 8));
    const result = detectExcursion(points, 4);
    expect(result.isExcursion).toBe(true);
    expect(result.ratioOverThreshold).toBe(1);
    expect(result.peakTemp).toBe(8);
  });

  it('5 points tous en-dessous du seuil → false, ratio=0', () => {
    const points = Array.from({ length: 5 }, (_, i) => buildPoint(i + 1, 2));
    const result = detectExcursion(points, 4);
    expect(result.isExcursion).toBe(false);
    expect(result.ratioOverThreshold).toBe(0);
  });

  it('10 points dont 8 au-dessus (ratio 0.8 exact) → true (boundary >=)', () => {
    const points = [
      ...Array.from({ length: 8 }, (_, i) => buildPoint(i + 1, 8)),
      ...Array.from({ length: 2 }, (_, i) => buildPoint(i + 9, 2)),
    ];
    const result = detectExcursion(points, 4);
    expect(result.isExcursion).toBe(true);
    expect(result.ratioOverThreshold).toBeCloseTo(0.8, 5);
  });

  it('10 points dont 7 au-dessus (ratio 0.7) → false (sous le seuil 80%)', () => {
    const points = [
      ...Array.from({ length: 7 }, (_, i) => buildPoint(i + 1, 8)),
      ...Array.from({ length: 3 }, (_, i) => buildPoint(i + 8, 2)),
    ];
    const result = detectExcursion(points, 4);
    expect(result.isExcursion).toBe(false);
    expect(result.ratioOverThreshold).toBeCloseTo(0.7, 5);
  });

  it("boundary temperature === threshold → comptée comme 'en-dessous' (strict >)", () => {
    const points = Array.from({ length: 5 }, (_, i) => buildPoint(i + 1, 4)); // exactement au seuil
    const result = detectExcursion(points, 4);
    expect(result.isExcursion).toBe(false);
    expect(result.ratioOverThreshold).toBe(0);
  });

  it('ordre des points indifférent (résultat identique sur input non trié)', () => {
    const ordered = Array.from({ length: 5 }, (_, i) => buildPoint(i + 1, 8));
    const shuffled = [...ordered].reverse();
    const a = detectExcursion(ordered, 4);
    const b = detectExcursion(shuffled, 4);
    expect(a.isExcursion).toBe(b.isExcursion);
    expect(a.ratioOverThreshold).toBe(b.ratioOverThreshold);
  });

  it('peakTemp est la température MAX, pas la moyenne', () => {
    const points = [
      buildPoint(1, 5),
      buildPoint(2, 8),
      buildPoint(3, 6),
      buildPoint(4, 12),
      buildPoint(5, 7),
    ];
    const result = detectExcursion(points, 4);
    expect(result.peakTemp).toBe(12);
  });
});
