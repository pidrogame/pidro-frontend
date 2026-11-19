import { lobbyApi } from '@/api/lobby';
import { useSettingsStore } from '@/stores/settings';
import { quickGameRequest } from '@/features/rules/ruleSets';
import type { RuleSet } from '@pidro/shared';

export async function createSoloRoom(ruleSet?: RuleSet) {
  const response = await lobbyApi.createRoom(
    quickGameRequest(ruleSet ?? useSettingsStore.getState().preferredRuleSet)
  );
  if (!response?.code) throw new Error('No room code returned');
  return response;
}
