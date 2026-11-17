/**
 * Each pass of the table compares a sprite's new target with the one on record:
 * a changed target moves the card. A finger holds a hand card where it is, and
 * its old target stays on record so a later pass still moves it (PID-444). A
 * card the play has taken out of the hand goes regardless: nothing would move
 * it once the finger lifts.
 */
export function retarget({
  recorded,
  signature,
  pressed,
  kind,
}: {
  recorded: string | undefined;
  signature: string;
  pressed: boolean;
  kind: 'hand' | 'cut' | 'played';
}) {
  const held = pressed && kind === 'hand';
  return { move: !held && recorded !== signature, record: !held };
}
