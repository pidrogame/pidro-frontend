/**
 * The hand card under a finger (PID-461): the one the eye sees there. Your
 * cards lie left to right, each over the one before it, raised or not, so of
 * the cards under the finger the rightmost is on top. A near miss, within
 * `NEAR` of a card, goes to a playable card before an unplayable one.
 */
type Target = { x: number; y: number; w: number; h: number };

const NEAR = 6;

export function cardUnder<T extends Target>(
  playable: T[],
  unplayable: T[],
  px: number,
  py: number
): T | null {
  'worklet';
  const rightmost = (ts: T[], near: number, best: T | null) => {
    for (const t of ts)
      if (
        Math.abs(px - t.x) < t.w / 2 + near &&
        Math.abs(py - t.y) < t.h / 2 + near &&
        (!best || t.x > best.x)
      )
        best = t;
    return best;
  };
  return (
    rightmost(unplayable, 0, rightmost(playable, 0, null)) ??
    rightmost(playable, NEAR, null) ??
    rightmost(unplayable, NEAR, null)
  );
}
