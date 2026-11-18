/**
 * What Android's Back does on a game's route (PID-458, PID-463). An open panel or
 * sheet is a native modal and the waiting room's folded talk has its own
 * listener: both take the press before this is asked. One stray press must not
 * cost a seat, so a player is asked first, also while the table loads, comes
 * back or failed to come back. Until the server says you watch, you may hold a
 * seat. With none to lose (watching, joining failed, the table is gone, or you
 * already left it) Back leaves at once, the way that screen's own button does.
 */
export type TableBack = 'ask' | 'leave' | 'home';

export type TableScreen =
  | 'joining'
  | 'restoring'
  | 'restore_failed'
  | 'waiting'
  | 'table'
  | 'over'
  | 'join_failed'
  | 'not_found'
  | 'away';

export function tableBack(screen: TableScreen, seated: boolean): TableBack {
  if (screen === 'join_failed' || screen === 'not_found' || screen === 'away') return 'leave';
  if (!seated) return 'leave';
  if (screen === 'over') return 'home';
  return 'ask';
}
