import { expect, it, mock } from 'bun:test';

it('each switch in Settings and at the table changes the setting its old control did', async () => {
  // Isolate the React Native doubles from other tests' modules.
  if (!process.env.SETTINGS_TEST_CHILD) {
    const child = Bun.spawnSync([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, SETTINGS_TEST_CHILD: '1' },
    });
    expect(child.stderr.toString()).not.toContain('(fail)');
    expect(child.exitCode).toBe(0);
    return;
  }
  const { JSDOM } = await import('jsdom');
  const { act, createElement: h } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
    __DEV__: false,
  });
  const view = ({ children }) => h('div', null, children);
  const none = () => null;
  mock.module('react-native', () => ({
    View: view,
    Platform: { OS: 'web' },
    StyleSheet: { create: (styles) => styles },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
  }));
  mock.module('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  }));
  mock.module('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
  mock.module('expo-application', () => ({
    nativeApplicationVersion: null,
    nativeBuildVersion: null,
  }));
  mock.module('expo-web-browser', () => ({ openBrowserAsync: async () => {} }));
  // The switch's own contract: a labelled control that asks for the other value.
  mock.module('../src/components/ui/PidroSwitch.tsx', () => ({
    PidroSwitch: ({ accessibilityLabel, value, disabled, onValueChange }) =>
      h('button', {
        'aria-label': accessibilityLabel,
        'aria-checked': String(value),
        disabled,
        onClick: () => onValueChange(!value),
      }),
  }));
  for (const [path, names] of [
    ['../src/components/ui/PidroText.tsx', ['PidroText']],
    ['../src/components/ui/PressableFX.tsx', ['PressableFX']],
    ['../src/components/ui/ScreenShell.tsx', ['ScreenShell']],
    ['../src/components/ui/Surface.tsx', ['Surface']],
    ['../src/components/ui/StillLayer.tsx', ['StillLayer']],
  ])
    mock.module(path, () => Object.fromEntries(names.map((name) => [name, view])));
  for (const [path, names] of [
    ['../src/components/ui/BevelButton.tsx', ['BevelButton']],
    ['../src/components/ui/Icon.tsx', ['Icon']],
    ['../src/components/ui/ScreenHeader.tsx', ['ScreenHeader']],
    ['../src/components/ui/Modal.tsx', ['Modal']],
    ['../src/components/ui/TextLink.tsx', ['TextLink']],
    ['../src/components/ui/Toast.tsx', ['Toast']],
    ['../src/components/rules/RuleSet.tsx', ['RuleSetChip', 'RuleSetSelector']],
    ['../src/components/rules/RulesExplainer.tsx', ['RulesExplainer']],
    ['../src/components/settings/LanguageSelector.tsx', ['LanguageSelector']],
    ['../src/components/settings/AccountSection.tsx', ['AccountSection']],
    ['../src/components/settings/AppUpdateSection.tsx', ['AppUpdateSection']],
    ['../src/components/settings/PremiumSection.tsx', ['PremiumSection', 'RestorePurchasesLink']],
    ['../src/components/settings/PrivacyChoicesRow.tsx', ['PrivacyChoicesRow']],
    ['../src/components/feedback/FeedbackSheet.tsx', ['FeedbackSheet']],
    ['../src/components/feedback/TellRow.tsx', ['TellRow']],
    ['../src/game/canvas/GameProblemReport.tsx', ['GameProblemReport']],
    ['../src/game/canvas/LeaveQuestion.tsx', ['LeaveQuestion']],
  ])
    mock.module(path, () => Object.fromEntries(names.map((name) => [name, none])));
  mock.module('../src/game/canvas/TableChrome.tsx', () => ({ headerTop: () => 0 }));
  mock.module('../src/game/canvas/TableUtilityWindow.tsx', () => ({
    TableUtilityWindow: ({ open, children }) => (open ? h('section', null, children) : null),
  }));
  mock.module('../src/features/feedback.ts', () => ({ canTell: () => false, tellFixture: none }));
  const hidden = [];
  mock.module('../src/components/league/LeagueHost.tsx', () => ({
    useLeague: () => ({
      data: { status: 'not_placed' },
      busy: false,
      setHidden: async (value) => hidden.push(value),
    }),
  }));
  // Bengt came from the old Pidro: untouched, Count for me starts off for him.
  const auth = { user: { id: 'u-1', username: 'Bengt', classic: true } };
  mock.module('../src/stores/auth.ts', () => ({ useAuthStore: (select) => select(auth) }));
  const shared = await import('@pidro/shared');
  const store = shared.createSettingsStore({ storage: memory() });
  mock.module('../src/stores/settings.ts', () => ({ useSettingsStore: store }));
  mock.module('../src/i18n/index.ts', () => ({
    ...shared,
    useTranslation: () => ({ t: shared.t, locale: 'en' }),
  }));
  const { SettingsScreen } = await import('../src/components/settings/SettingsScreen.tsx');
  const { TableSettings } = await import('../src/game/canvas/TableSettings.tsx');

  const root = createRoot(document.getElementById('root'));
  const render = (element) => act(async () => root.render(element));
  const control = (name) => document.querySelector(`button[aria-label="${name}"]`);
  const toggle = (name) => act(async () => control(name).click());
  const state = () => store.getState();
  try {
    await render(h(SettingsScreen, { onBack: () => {} }));
    expect(control('Count for me').getAttribute('aria-checked')).toBe('false');
    await toggle('Count for me');
    expect(state().countHelp).toBe(true);
    await toggle('Count for me');
    expect(state().countHelp).toBe(false);
    expect(control('Wait for me').getAttribute('aria-checked')).toBe('false');
    await toggle('Wait for me');
    expect(state().pace).toBe('own');
    await toggle('Wait for me');
    expect(state().pace).toBe('quick');
    await toggle('Sound');
    expect([state().soundEnabled, state().hapticEnabled]).toEqual([false, true]);
    await toggle('Vibration');
    expect([state().soundEnabled, state().hapticEnabled]).toEqual([false, false]);
    await toggle('Hide me from leagues');
    expect(hidden).toEqual([true]);
    expect(document.body.textContent).toContain('Winning card, trick points, last trick.');
    expect(document.body.textContent).toContain('Bot games: the next hand waits for your tap.');

    // At a bot table the same two switches change the same settings.
    await render(h(TableSettings, { onLeave: () => {}, isSolo: true, initiallyOpen: true }));
    expect(document.body.textContent).toContain('Bot games: the next hand waits for your tap.');
    await toggle('Count for me');
    expect(state().countHelp).toBe(true);
    await toggle('Wait for me');
    expect(state().pace).toBe('own');
    await toggle('Sound');
    expect([state().soundEnabled, state().hapticEnabled]).toEqual([true, false]);
    await toggle('Vibration');
    expect([state().soundEnabled, state().hapticEnabled]).toEqual([true, true]);

    // With people at the table it plays quick: Wait for me shows the choice but cannot change it.
    await act(async () => root.unmount());
    const people = createRoot(document.getElementById('root'));
    await act(async () =>
      people.render(h(TableSettings, { onLeave: () => {}, initiallyOpen: true }))
    );
    expect(control('Wait for me').disabled).toBe(true);
    expect(control('Wait for me').getAttribute('aria-checked')).toBe('true');
    await toggle('Wait for me');
    expect(state().pace).toBe('own');
    expect(document.body.textContent).toContain('Tables with people play quick.');
    await act(async () => people.unmount());
  } finally {
    dom.window.close();
  }
});

function memory() {
  let value = null;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    removeItem: () => {
      value = null;
    },
  };
}
