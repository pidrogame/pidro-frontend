/**
 * What Android's Back does at a table (PID-458). An open panel or sheet is a
 * native modal and the waiting room's folded talk has its own listener: both
 * take the press before this is asked. One stray press must not cost a seat.
 */
export type TableBack = 'ask' | 'leave' | 'home';

export function tableBack(table: { watching: boolean; over: boolean }): TableBack {
  if (table.watching) return 'leave';
  if (table.over) return 'home';
  return 'ask';
}
