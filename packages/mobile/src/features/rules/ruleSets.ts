import type {
  CreateRoomRequest,
  LobbyCategories,
  Room,
  RuleSet,
  TranslationKey,
} from '@pidro/shared';
import { roomHasUser } from '@/features/lobby/newTable';

export const ruleSets: Record<RuleSet, { labelKey: TranslationKey; longKey: TranslationKey }> = {
  finnish: { labelKey: 'rules.finnish', longKey: 'rules.long.finnish' },
  louisiana: { labelKey: 'rules.louisiana', longKey: 'rules.long.louisiana' },
};

export function lobbyRuleSetFilter(preferred: RuleSet, saved: RuleSet | 'all' | null) {
  return saved ?? preferred;
}

export function filterRuleSet(rooms: Room[], filter: RuleSet | 'all'): Room[] {
  return rooms.filter(
    (room) => filter === 'all' || (room.config?.rule_set ?? 'finnish') === filter
  );
}

/**
 * A table you sit at stays in Tables whatever the filter, in any category (a waiting one
 * is listed with the open tables); the tables you could join follow the filter.
 */
export function filterLobby(
  lobby: LobbyCategories,
  filter: RuleSet | 'all',
  userId?: string | null
): LobbyCategories {
  const keep = (rooms: Room[]) =>
    rooms.filter((room) => roomHasUser(room, userId) || filterRuleSet([room], filter).length);
  return {
    my_rejoinable: lobby.my_rejoinable,
    open_tables: keep(lobby.open_tables),
    substitute_needed: keep(lobby.substitute_needed),
    spectatable: keep(lobby.spectatable),
  };
}

/** The filter shows only when the tables it would filter hold both rule sets. */
export function lobbyHasBothRuleSets(lobby: LobbyCategories, userId?: string | null) {
  const tables = [...lobby.open_tables, ...lobby.substitute_needed, ...lobby.spectatable].filter(
    (room) => !roomHasUser(room, userId)
  );
  return (
    filterRuleSet(tables, 'finnish').length > 0 && filterRuleSet(tables, 'louisiana').length > 0
  );
}

export function shouldExplainLouisiana(ruleSet: RuleSet, seen: boolean, spectator: boolean) {
  return ruleSet === 'louisiana' && !seen && !spectator;
}

export function quickGameRequest(preferred: RuleSet): CreateRoomRequest {
  return {
    rule_set: preferred,
    seats: { seat_2: 'ai', seat_3: 'ai', seat_4: 'ai' },
    ads_aware: true,
  };
}
