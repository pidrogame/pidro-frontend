import type { CreateRoomRequest, Room, RuleSet, TranslationKey } from '@pidro/shared';

export const ruleSets: Record<RuleSet, { labelKey: TranslationKey }> = {
  finnish: { labelKey: 'rules.finnish' },
  louisiana: { labelKey: 'rules.louisiana' },
};

export function lobbyRuleSetFilter(preferred: RuleSet, saved: RuleSet | 'all' | null) {
  return saved ?? preferred;
}

export function filterRuleSet(rooms: Room[], filter: RuleSet | 'all'): Room[] {
  return rooms.filter(
    (room) => filter === 'all' || (room.config?.rule_set ?? 'finnish') === filter
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
