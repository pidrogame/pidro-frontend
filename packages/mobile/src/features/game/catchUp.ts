/**
 * How fast to show a moment the server has already timed. The server moves on
 * `windowMs` after the moment began; `lateMs` of that is gone before this
 * phone could start (a busy phone takes states in late). The motion takes
 * `motionMs` at its own pace, and the result should stay up `holdMs` before
 * the server moves on.
 *
 * 1 plays it as designed, less plays it faster to land in time, 0 skips the
 * motion and shows where it ends: a phone this far behind catches up instead
 * of replaying the past. Without a known window it plays as designed.
 */
export function catchUpPace({
  motionMs,
  holdMs = 0,
  windowMs,
  lateMs,
}: {
  motionMs: number;
  holdMs?: number;
  windowMs?: number | null;
  lateMs: number;
}): number {
  if (windowMs == null || !(windowMs > 0) || motionMs <= 0) return 1;
  const room = windowMs - Math.max(0, lateMs) - holdMs;
  if (room >= motionMs) return 1;
  const pace = room / motionMs;
  return pace < SLOWEST_READABLE ? 0 : pace;
}

/** Below about a third of its pace, motion is a blur, not a reveal: skip it. */
const SLOWEST_READABLE = 0.35;
