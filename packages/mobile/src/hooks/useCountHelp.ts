import { countHelpOn } from '@/features/countHelp';
import { useAuthStore } from '@/stores/auth';
import { useSettingsStore } from '@/stores/settings';

/** The one place the app asks whether count help is on. */
export function useCountHelp() {
  const choice = useSettingsStore((state) => state.countHelp);
  const classic = useAuthStore((state) => state.user?.classic);
  return countHelpOn(choice, { classic });
}
