import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { PersistStorage } from '../platform/types';
import type { RuleSet } from '../types/lobby';
import { resolveLocale, type LanguagePreference } from '../i18n';

interface SettingsState {
  language: LanguagePreference;
  hydrated: boolean;
  setLanguage: (language: LanguagePreference) => void;
  setHydrated: (hydrated: boolean) => void;
  theme: 'light' | 'dark' | 'system';
  soundEnabled: boolean;
  hapticEnabled: boolean;
  /** The pin each player on this device chose to wear. Unset wears the default. */
  pins: Record<string, PinChoice>;
  preferredRuleSet: RuleSet;
  lobbyRuleSetFilter: RuleSet | 'all' | null;
  hasSeenLouisianaRules: boolean;
  /** Beginner aids at the table: the bidders' count and the last trick (PID-220). */
  countHelp: boolean;
  showBid: boolean;
  /** Requested pace at tables where this player is the only human. */
  pace: TablePace;

  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  toggleSound: () => void;
  toggleHaptic: () => void;
  setPin: (userId: string, pin: PinChoice) => void;
  setPreferredRuleSet: (preferredRuleSet: RuleSet) => void;
  setLobbyRuleSetFilter: (lobbyRuleSetFilter: RuleSet | 'all') => void;
  markLouisianaRulesSeen: () => void;
  toggleCountHelp: () => void;
  toggleShowBid: () => void;
  setPace: (pace: TablePace) => void;
}

export type PinChoice = 'classic' | 'none';
export type TablePace = 'quick' | 'own';

interface CreateSettingsStoreOptions {
  storage: PersistStorage;
  storageKey?: string;
  /** The device's ordered language tags; shared imports no platform API. */
  detectLanguageTags?: () => readonly string[];
}

export function createSettingsStore({
  storage,
  storageKey = 'settings-storage',
  detectLanguageTags = () => [],
}: CreateSettingsStoreOptions) {
  let deviceLanguage: LanguagePreference = 'en';
  try {
    deviceLanguage = resolveLocale(detectLanguageTags());
  } catch {
    /* English when the device cannot say. */
  }
  return create<SettingsState>()(
    persist(
      (set) => ({
        language: deviceLanguage,
        hydrated: false,
        setLanguage: (language) => set({ language }),
        setHydrated: (hydrated) => set({ hydrated }),
        theme: 'system',
        soundEnabled: true,
        hapticEnabled: true,
        pins: {},
        preferredRuleSet: 'finnish',
        lobbyRuleSetFilter: null,
        hasSeenLouisianaRules: false,
        countHelp: false,
        showBid: true,
        pace: 'quick',

        setTheme: (theme) => set({ theme }),
        toggleSound: () => set((state) => ({ soundEnabled: !state.soundEnabled })),
        toggleHaptic: () => set((state) => ({ hapticEnabled: !state.hapticEnabled })),
        setPin: (userId, pin) => set((state) => ({ pins: { ...state.pins, [userId]: pin } })),
        setPreferredRuleSet: (preferredRuleSet) => set({ preferredRuleSet }),
        setLobbyRuleSetFilter: (lobbyRuleSetFilter) => set({ lobbyRuleSetFilter }),
        markLouisianaRulesSeen: () => set({ hasSeenLouisianaRules: true }),
        toggleCountHelp: () => set((state) => ({ countHelp: !state.countHelp })),
        toggleShowBid: () => set((state) => ({ showBid: !state.showBid })),
        setPace: (pace) => set({ pace }),
      }),
      {
        name: storageKey,
        storage: createJSONStorage(() => storage),
        partialize: ({ hydrated, ...state }) => state,
        // Default merge migrates old version-0 stores without losing their preferences.
        // A new install, or a saved 'system' from an older build, takes the device's language
        // once; hydration then saves it, so the choice stays put if the device changes.
        merge: (persisted, current) => {
          const saved = persisted as
            (Omit<Partial<SettingsState>, 'pace'> & { pace?: string }) | undefined;
          const language = saved?.language;
          return {
            ...current,
            ...saved,
            pace: saved?.pace === 'slow' || saved?.pace === 'own' ? 'own' : 'quick',
            hydrated: false,
            language: language === 'en' || language === 'sv' ? language : deviceLanguage,
          };
        },
        onRehydrateStorage: (initial) => (_state, error) => {
          // A synchronous read/JSON failure can occur before Zustand finishes
          // assigning initial state. Defer that fallback so it is not overwritten.
          if (error) queueMicrotask(() => initial.setHydrated(true));
          else initial.setHydrated(true);
        },
      }
    )
  );
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;
