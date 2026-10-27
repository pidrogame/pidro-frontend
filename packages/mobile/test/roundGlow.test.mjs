import { expect, test } from 'bun:test';
import { blurredDisc, roundGlow } from '../src/features/roundGlow.ts';

test('a blurred disc covers half its own edge and fades as a Gaussian does past it', () => {
  // Far larger than the blur, the edge is a straight line: Φ(0) = 0.5, Φ(−1) ≈ 0.159, Φ(−2) ≈ 0.023.
  expect(blurredDisc(1000, 1000, 5)).toBeCloseTo(0.5, 2);
  expect(blurredDisc(1005, 1000, 5)).toBeCloseTo(0.159, 2);
  expect(blurredDisc(1010, 1000, 5)).toBeCloseTo(0.023, 2);
  expect(blurredDisc(0, 1000, 5)).toBeCloseTo(1, 3);
  // A small disc spreads thin: its centre is never fully covered.
  expect(blurredDisc(0, 4, 8)).toBeLessThan(0.2);
});

test('a round glow is empty inside its circle and reaches three sigmas past the spread', () => {
  const glow = roundGlow({ radius: 30, blur: 20, spread: 6, color: 'rgba(139, 234, 255, 0.6)' });
  expect(glow.extent).toBe(30 + 6 + 30);
  const stops = [...glow.backgroundImage.matchAll(/rgba\(([^)]*)\) ([\d.]+)%/g)].map((m) => ({
    alpha: Number(m[1].split(',')[3]),
    at: Number(m[2]),
  }));
  expect(stops[0].alpha).toBe(0);
  expect(stops[0].at).toBeLessThan((30 / 66) * 100);
  // Just outside the circle the light is brightest, and it only fades from there.
  const alphas = stops.slice(1).map((stop) => stop.alpha);
  expect(alphas[0]).toBeGreaterThan(0.3);
  expect(alphas.every((alpha, i) => i === 0 || alpha <= alphas[i - 1])).toBe(true);
  expect(stops.at(-1).alpha).toBeLessThan(0.01);
  expect(stops.at(-1).at).toBe(100);
});
