/**
 * A round `boxShadow` (`0px 0px blur spread color` around a circle of
 * `radius`) as a radial gradient: the same soft light, but nothing is blurred
 * when it draws, so it can breathe and scale on an old phone. The stops sample
 * the exact profile of a blurred disc (CSS blurs with σ = blur / 2), and,
 * like the shadow, nothing is drawn inside the circle itself.
 *
 * `extent` is the glow's radius: the gradient fills a square of 2 × extent
 * centred on the circle.
 */
export function roundGlow({
  radius,
  blur,
  spread,
  color,
}: {
  radius: number;
  blur: number;
  spread: number;
  color: string;
}): { extent: number; backgroundImage: string } {
  const sigma = blur / 2;
  const disc = radius + spread;
  const extent = disc + 3 * sigma;
  const [r, g, b, a] = rgba(color);
  const at = (d: number, alpha: number) =>
    `rgba(${r}, ${g}, ${b}, ${round(alpha, 4)}) ${round((d / extent) * 100, 3)}%`;
  // The circle's own edge stays sharp, as the shadow's clip is: half a point wide, as the clip antialiases.
  const edge = radius + 0.375;
  const stops = [at(radius - 0.125, 0)];
  for (let i = 0; i <= STEPS; i++) {
    const d = edge + ((extent - edge) * i) / STEPS;
    stops.push(at(d, a * blurredDisc(d, disc, sigma)));
  }
  return { extent, backgroundImage: `radial-gradient(circle closest-side, ${stops.join(', ')})` };
}

const STEPS = 24;

/** How much of a disc of radius `disc`, blurred by `sigma`, covers a point `d` from its centre. */
export function blurredDisc(d: number, disc: number, sigma: number): number {
  if (sigma <= 0) return d <= disc ? 1 : 0;
  // ∫ ρ/σ² · e^(−(d²+ρ²)/2σ²) · I₀(dρ/σ²) dρ over the disc, by Simpson's rule,
  // only where the blur reaches: within six sigmas of d.
  const from = Math.max(0, d - 6 * sigma);
  const to = Math.min(disc, d + 6 * sigma);
  if (to <= from) return d < disc ? 1 : 0;
  const n = 120;
  const h = (to - from) / n;
  let sum = 0;
  for (let i = 0; i <= n; i++) {
    const p = from + i * h;
    const f =
      (p / (sigma * sigma)) *
      Math.exp(-((d - p) ** 2) / (2 * sigma * sigma)) *
      besselI0e((d * p) / (sigma * sigma));
    sum += f * (i === 0 || i === n ? 1 : i % 2 ? 4 : 2);
  }
  return Math.min(1, (sum * h) / 3);
}

/** e^(−x) · I₀(x), the scaled Bessel function (Abramowitz and Stegun 9.8.1–2). */
function besselI0e(x: number): number {
  if (x < 3.75) {
    const t = (x / 3.75) ** 2;
    const i0 =
      1 +
      t *
        (3.5156229 +
          t * (3.0899424 + t * (1.2067492 + t * (0.2659732 + t * (0.0360768 + t * 0.0045813)))));
    return i0 * Math.exp(-x);
  }
  const t = 3.75 / x;
  return (
    (0.39894228 +
      t *
        (0.01328592 +
          t *
            (0.00225319 +
              t *
                (-0.00157565 +
                  t *
                    (0.00916281 +
                      t *
                        (-0.02057706 + t * (0.02635537 + t * (-0.01647633 + t * 0.00392377)))))))) /
    Math.sqrt(x)
  );
}

function rgba(color: string): [number, number, number, number] {
  const m = color.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)/);
  if (!m) throw new Error(`roundGlow needs an rgb() or rgba() colour, not ${color}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] == null ? 1 : Number(m[4])];
}

function round(value: number, digits: number) {
  return Number(value.toFixed(digits));
}
