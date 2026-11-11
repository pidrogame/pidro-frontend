import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { TRICK_SWEEP_ENABLED } from '../src/game/canvas/animationTiming.ts';
import { cardSize, TRICK_GAP, TRUMP_MARK } from '../src/game/canvas/layout.ts';
import { partitionCases, verifyCoverage } from './ui-shards.mjs';
import {
  assertAccountSurfaceFits,
  assertInsideViewport,
  assertMinimumTouchTargets,
  assertTeamLayout,
  getStableBox,
  talkCases,
  suppressDevOverlays,
  UI_VIEWPORTS,
  waitForImages,
  waitForScreenshotReady,
} from './ui-test-utils.mjs';

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(mobileRoot, '../../..');
const baseUrl = process.env.MOBILE_BASE_URL ?? 'http://localhost:8081';
const screenshotRoot = process.env.UI_SHOT_DIR ?? resolve(repoRoot, 'screenshots/agent-mobile-ui');
const nameList = (value) =>
  new Set(
    (value ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
  );
const requestedCases = nameList(process.env.UI_CASES);
const requestedViewports = nameList(process.env.UI_VIEWPORTS);
const authFixture = JSON.stringify({
  state: {
    accessToken: 'ui-grammar-token',
    refreshToken: null,
    user: { id: 'ui-grammar-user', username: 'Bengt', age_band: '18_plus' },
  },
  version: 0,
});
const guestAuthFixture = JSON.stringify({
  state: {
    accessToken: 'ui-grammar-guest-token',
    refreshToken: null,
    user: {
      id: 'ui-grammar-guest',
      username: 'guest_7KQ4M2XB',
      display_name: 'Lucky Moose',
      guest: true,
      age_band: '18_plus',
    },
  },
  version: 0,
});
// PID-124: only a player with Premium sees Settings → Premium.
const premiumAuthFixture = JSON.stringify({
  state: {
    accessToken: 'ui-grammar-token',
    refreshToken: null,
    user: {
      id: 'ui-grammar-user',
      username: 'Bengt',
      age_band: '18_plus',
      premium: true,
      premium_until: null,
      premium_source: 'promotional',
    },
  },
  version: 0,
});
const ageGateFixture = JSON.stringify({
  state: { ageBand: '18_plus', termsVersion: '1' },
  version: 0,
});

// PID-316: Tell us. Bengt has an account email to answer at; the guest does not.
const tellAuthFixture = JSON.stringify({
  state: {
    accessToken: 'ui-grammar-token',
    refreshToken: null,
    user: {
      id: 'ui-grammar-user',
      username: 'Bengt',
      email: 'bengt@example.com',
      age_band: '18_plus',
    },
  },
  version: 0,
});
const TELL_VIEWPORTS = ['portrait', 'small-portrait', 'landscape', 'tablet-portrait'];
const TELL_WORDS = 'The bid buttons are small on my phone. Otherwise lovely to have the game back.';
const tellCases = [
  { name: 'tell-home', path: '/home', testId: 'home-screen', tell: 'home' },
  {
    name: 'tell-home-guest',
    path: '/home',
    testId: 'home-screen',
    tell: 'home',
    authFixture: guestAuthFixture,
    tellViewports: [...TELL_VIEWPORTS, 'compact-portrait'],
  },
  // PID-348: account is a guest the server turned away, should one reach the sheet.
  ...['open', 'typing', 'chip', 'sent', 'failed', 'limit', 'account'].map((state) => ({
    name: `tell-${state}`,
    path: `/home?fixture=tell-${state}`,
    testId: 'feedback-sheet',
    tell: state,
  })),
  // A player without an email on the account types an address (guests have no Tell us, PID-348).
  {
    name: 'tell-guest',
    path: '/settings?fixture=tell-guest',
    testId: 'feedback-sheet',
    tell: 'guest',
    authFixture,
  },
  // The keyboard takes this much of the screen: the card gives way, Send stays.
  {
    name: 'tell-keyboard',
    path: '/home?fixture=tell-typing',
    testId: 'feedback-sheet',
    tell: 'typing',
    tellViewports: ['small-portrait', 'landscape', 'tablet-portrait'],
    viewports: {
      'small-portrait': { height: 667 - 260 },
      landscape: { height: 390 - 209 },
      'tablet-portrait': { height: 1024 - 398 },
    },
  },
  { name: 'tell-pace', path: '/home?fixture=tell-pace', testId: 'feedback-ask', tell: 'pace' },
  { name: 'tell-old', path: '/home?fixture=tell-old', testId: 'feedback-ask', tell: 'old' },
  {
    name: 'tell-notice-wins',
    path: '/home?fixture=popup-update',
    testId: 'news-popup',
    popup: 'update',
    tell: 'notice',
    tellViewports: ['portrait'],
  },
  {
    name: 'tell-send',
    path: '/home?fixture=tell-typing',
    testId: 'feedback-sheet',
    tell: 'send',
    tellViewports: ['portrait'],
  },
  {
    name: 'tell-send-fails',
    path: '/home?fixture=tell-typing',
    testId: 'feedback-sheet',
    tell: 'send-fails',
    tellViewports: ['portrait'],
  },
  ...['home', 'open', 'typing', 'sent', 'failed', 'limit', 'pace', 'old'].map((state) => ({
    name: `tell-${state}-sv`,
    path: state === 'home' ? '/home' : `/home?fixture=tell-${state}`,
    testId:
      state === 'home'
        ? 'home-screen'
        : ['pace', 'old'].includes(state)
          ? 'feedback-ask'
          : 'feedback-sheet',
    tell: state,
    tellLocale: 'sv',
    tellViewports: ['portrait'],
  })),
].map((testCase) => ({ authenticated: true, authFixture: tellAuthFixture, ...testCase }));

// PID-347: News on Home. The fixtures carry their posts; Write back posts to the routed feedback.
const newsCases = ['home', 'request', 'sheet', 'reply', 'empty', 'error'].map((state) => ({
  name: `news-${state}`,
  path: `/home?fixture=news-${state}`,
  testId: ['home', 'request'].includes(state)
    ? 'home-screen'
    : state === 'reply'
      ? 'feedback-sheet'
      : 'news-sheet',
  news: state,
  authenticated: true,
  authFixture: tellAuthFixture,
}));
// PID-348: a guest reads the same posts, with no Tell us and no Write back.
newsCases.push({
  ...newsCases.find(({ news }) => news === 'sheet'),
  name: 'news-sheet-guest',
  authFixture: guestAuthFixture,
});

// iPad portrait and landscape for game over, on CI's existing tablet shards.
const GAME_OVER_TABLETS = {
  'tablet-portrait': { width: 834, height: 1194 },
  'tablet-landscape': { width: 1194, height: 834 },
};

const allCases = [
  ...['en', 'sv'].flatMap((locale) => [
    {
      name: `scores-${locale}-table`,
      path: `/table-dev?fixture=scores&locale=${locale}`,
      testId: 'hand-history',
      scores: 'table',
      locale,
    },
    {
      name: `scores-${locale}-game-over`,
      path: `/table-dev?fixture=scores-game-over&locale=${locale}`,
      testId: 'hand-history',
      scores: 'game-over',
      locale,
    },
    {
      name: `scores-${locale}-chart`,
      path: `/table-dev?fixture=scores-game-over&locale=${locale}`,
      testId: 'game-over-window',
      scores: 'chart',
      locale,
      gameOver: {},
    },
    ...['all-14', 'all-14-theirs'].flatMap((result) =>
      [false, true].map((waiting) => ({
        name: `scores-${locale}-${result}${waiting ? '-own' : ''}`,
        path: `/table-dev?fixture=${result}&locale=${locale}${waiting ? '&hand=own&safeArea=android' : ''}`,
        testId: 'hand-result',
        scores: result,
        locale,
      }))
    ),
  ]),
  { name: 'home', path: '/home', testId: 'home-screen', authenticated: true },
  {
    name: 'home-waiting',
    path: '/home?fixture=waiting',
    testId: 'home-screen',
    authenticated: true,
    homeProfile: true,
  },
  {
    name: 'home-waiting-guest',
    path: '/home?fixture=invitations',
    testId: 'home-screen',
    authenticated: true,
    authFixture: guestAuthFixture,
    homeProfile: true,
  },
  {
    name: 'profile-friends',
    path: '/profile?fixture=list',
    testId: 'profile-screen',
    authenticated: true,
    homeProfile: true,
  },
  {
    name: 'profile-friends-zero',
    path: '/profile?fixture=empty',
    testId: 'profile-screen',
    authenticated: true,
    homeProfile: true,
  },
  // PID-339: Bengt from the Status-Profile board, a Legend with four stars.
  {
    name: 'profile-legend',
    path: '/profile?fixture=legend',
    testId: 'profile-screen',
    authenticated: true,
    authFixture: tellAuthFixture,
    homeProfile: true,
  },
  {
    name: 'friends-from-profile',
    path: '/friends?fixture=list&from=profile',
    testId: 'friends-screen',
    authenticated: true,
    homeProfile: true,
  },
  {
    name: 'profile-friends-guest',
    path: '/friends?from=profile',
    testId: 'auth-sheet',
    authenticated: true,
    authFixture: guestAuthFixture,
    homeProfile: true,
  },
  ...['android-gesture', 'android-buttons'].flatMap((safeArea) =>
    [
      { screen: 'home', path: '/home', testId: 'home-screen' },
      { screen: 'profile', path: '/profile', testId: 'profile-screen' },
      { screen: 'table', path: '/table-dev?phase=playing', testId: 'seat-south' },
      {
        screen: 'hand-log',
        path: '/table-dev?phase=playing&count=on',
        openLog: true,
        testId: 'hand-log-entry-trump-4',
      },
    ].map(({ screen, path, ...props }) => ({
      ...props,
      name: `edge-${screen}-${safeArea}`,
      path: `${path}${path.includes('?') ? '&' : '?'}safeArea=${safeArea}`,
      authenticated: true,
    }))
  ),
  ...['joining', 'restoring', 'loading'].map((fixture) => ({
    name: `game-${fixture}`,
    path: `/game/7KQ4M2XB?fixture=${fixture}`,
    testId: 'game-loading-screen',
    authenticated: true,
  })),
  ...['request', 'accepted', 'linked', 'seat', 'offline', 'queue', 'too-late'].map((kind) => ({
    name: `friend-notice-${kind}`,
    path: `/home?fixture=friend-${kind}`,
    testId: 'friend-notice',
    authenticated: true,
  })),
  {
    name: 'home-invitations',
    path: '/home?fixture=invitations',
    testId: 'home-screen',
    authenticated: true,
  },
  {
    name: 'lobby-invitations',
    path: '/lobby?fixture=invitations',
    testId: 'lobby-screen',
    authenticated: true,
  },
  { name: 'lobby-held', path: '/lobby?fixture=held', testId: 'lobby-screen', authenticated: true },
  // PID-360: react-native-web's Alert shows nothing, so the web asks in a Modal.
  {
    name: 'lobby-at-table',
    path: '/lobby?fixture=at-table',
    testId: 'lobby-screen',
    authenticated: true,
  },
  ...['password', 'password-keypad', 'password-typed', 'password-wrong', 'password-wait'].map(
    (fixture) => ({
      name: `lobby-${fixture}`,
      path: `/lobby?fixture=${fixture}`,
      testId: fixture === 'password' ? 'lobby-screen' : 'password-keypad',
      authenticated: true,
      lobbyFixture: fixture,
    })
  ),
  // Both landscape directions: the panel stays clear of the camera side and the home bar.
  ...['island-left', 'island-right'].map((safeArea) => ({
    name: `lobby-password-${safeArea}`,
    path: `/lobby?fixture=password-typed&safeArea=${safeArea}`,
    testId: 'password-keypad',
    authenticated: true,
    skipViewports: ['portrait'],
    insets: safeArea === 'island-left' ? { left: 59, right: 0 } : { left: 0, right: 59 },
  })),
  {
    name: 'waiting-held',
    path: '/table-dev?phase=waiting-host&fixture=held',
    testId: 'waiting-table',
    authenticated: true,
  },
  ...['empty', 'list', 'all', 'added-you', 'loading', 'error', 'classic'].map((fixture) => ({
    name: `friends-${fixture}`,
    path: `/friends?fixture=${fixture}`,
    testId: 'friends-screen',
    authenticated: true,
  })),
  {
    name: 'friends-link-profile',
    path: '/friends?fixture=link-profile',
    testId: 'player-sheet',
    authenticated: true,
  },
  ...['profile', 'remove', 'block'].map((state) => ({
    name: `friends-${state}`,
    path: '/friends?fixture=list',
    testId: state === 'profile' ? 'player-sheet' : 'friend-sheet',
    authenticated: true,
    open: 'View Nora’s profile',
  })),
  ...['partner', 'opponent', 'full', 'online', 'bots', 'offline', 'request', 'remove', 'block'].map(
    (state) => ({
      name: `friends-sheet-${state}`,
      path: `/friends?fixture=sheet-${state}`,
      testId: 'friend-sheet',
      authenticated: true,
    })
  ),
  ...['empty', 'filled', 'loading', 'error'].map((fixture) => ({
    name: `blocked-${fixture}`,
    path: `/blocked-players?fixture=${fixture}`,
    testId: 'blocked-players-screen',
    authenticated: true,
  })),
  // PID-340: Kalle's sheet from `Status-Player`, over the `Status-Seats` table.
  {
    name: 'player-sheet-kalle',
    path: '/table-dev?fixture=status&role=player&seats=a&sheet=kalle',
    testId: 'player-sheet',
    authenticated: true,
  },
  // A seated player in a lobby row opens their sheet.
  {
    name: 'lobby-player-sheet',
    path: '/lobby?fixture=open',
    testId: 'lobby-screen',
    authenticated: true,
  },
  ...['playing', 'game_over'].map((phase) => ({
    name: `block-profile-${phase}`,
    path: `/table-dev?phase=${phase}&role=player`,
    testId: 'player-sheet',
    authenticated: true,
    open: /^View mfios1’s profile/,
    playerProfile: true,
  })),
  ...['en', 'sv'].flatMap((locale) => [
    ...['Marcel', 'Antti', 'Jocke'].map((name) => ({
      name: `table-bot-card-${name.toLowerCase()}-${locale}`,
      path: `/table-dev?fixture=bot-crew&locale=${locale}`,
      testId: 'bot-profile-modal',
      open:
        locale === 'sv'
          ? new RegExp(`^Visa profilen för ${name},`)
          : new RegExp(`^View ${name}’s profile,`),
      botCard: name,
      botVoice: true,
      locale,
    })),
    // PID-405: a catalogue character who plays the odds says so on her sheet.
    {
      name: `table-bot-card-saga-${locale}`,
      path: `/table-dev?fixture=bot-crew&character=saga&locale=${locale}`,
      testId: 'bot-profile-modal',
      open: locale === 'sv' ? /^Visa profilen för Saga,/ : /^View Saga’s profile,/,
      botCard: 'Saga',
      botPlay: 'search',
      botVoice: true,
      locale,
    },
    ...[
      { name: '', seat: 'west', en: 'Let’s see…', sv: 'Ska vi se…' },
      { name: '-antti', seat: 'north', en: 'One moment…', sv: 'Ett ögonblick…' },
      { name: '-jocke', seat: 'east', en: 'A trump…', sv: 'Trumf, månne…' },
    ].map(({ name, seat, ...text }) => ({
      name: `table-bot-thinking${name}-${locale}`,
      path: `/table-dev?fixture=bot-crew&botTurn=${seat}&locale=${locale}`,
      testId: `seat-${seat}`,
      thinkingText: text[locale],
      botVoice: true,
      locale,
    })),
  ]),
  // PID-405: her longest catalogue line, 40 characters, is cut short inside her seat.
  {
    name: 'table-bot-thinking-saga-cut',
    path: '/table-dev?fixture=bot-crew&character=saga&botTurn=north',
    testId: 'seat-north',
    thinkingText: 'Hmmm… nå… jaha… tja… hmm… nå… jaha… tja…',
    thinkingCut: true,
    // Beside the avatar in landscape, North says the plain turn text instead.
    landscapeText: 'Playing…',
    botVoice: true,
    locale: 'en',
  },
  ...talkCases.map((name) => {
    const state = name.replace('table-talk-', '');
    const locale = state.startsWith('sv-') ? 'sv' : 'en';
    const fixture = `talk-${state.replace('sv-', '').replace('send', 'quiet').replace('offer-tap', 'offer').replace('face-tap', 'coin').replace('reported', 'report').replace('say-word', 'typing').replace('say', 'typing')}`;
    return {
      name,
      path: `/table-dev?fixture=${fixture}&locale=${locale}`,
      testId: 'game-table',
      talk: state.replace('sv-', ''),
      // Antti's sheet offers Block to an account (PID-406).
      authenticated: state === 'face-tap',
      locale,
    };
  }),
  {
    name: 'block-profile-guest',
    path: '/table-dev?phase=game_over&role=player',
    testId: 'player-sheet',
    authenticated: true,
    authFixture: guestAuthFixture,
    open: 'View mfios1’s profile',
    playerProfile: true,
  },
  ...['recent', 'results'].map((fixture) => ({
    name: `friends-${fixture}`,
    path: `/friends-add?fixture=${fixture}`,
    testId: 'friends-add-screen',
    authenticated: true,
  })),
  {
    name: 'friends-guest',
    path: '/friends',
    testId: 'auth-sheet',
    authenticated: true,
    authFixture: guestAuthFixture,
  },
  {
    name: 'home-guest',
    path: '/home',
    testId: 'home-screen',
    authenticated: true,
    authFixture: guestAuthFixture,
  },
  {
    name: 'home-table-unknown',
    path: '/home?fixture=table-unknown',
    testId: 'home-screen',
    authenticated: true,
  },
  {
    name: 'game-away',
    path: '/game/AWAY01?fixture=away',
    testId: 'game-away-window',
    authenticated: true,
  },
  { name: 'profile', path: '/profile', testId: 'profile-screen', authenticated: true },
  {
    name: 'profile-guest',
    path: '/profile',
    testId: 'profile-screen',
    authenticated: true,
    authFixture: guestAuthFixture,
  },
  {
    name: 'profile-badges',
    path: '/profile',
    testId: 'badge-sheet',
    authenticated: true,
    open: 'Your photo and ring',
  },
  // PID-297: the profile camera and every held photo-sheet state, with Classic pins.
  // PID-395: Your picture, Face 1, Face 2 or Photo; face saved and face error.
  ...['en', 'sv'].flatMap((locale) =>
    (locale === 'en'
      ? ['profile', 'empty', 'present', 'uploading', 'saved', 'error', 'remove']
      : ['profile', 'empty', 'present', 'error']
    )
      .concat(['face', 'face-saved', 'face-error'])
      .map((state) => ({
        name: `photo-${state}-${locale}`,
        path: `/profile?fixture=photo-${state}`,
        testId: state === 'profile' ? 'profile-screen' : 'badge-sheet',
        authenticated: true,
        locale,
        photo: state,
      }))
  ),
  {
    name: 'photo-profile-guest',
    path: '/profile',
    testId: 'profile-screen',
    authenticated: true,
    authFixture: guestAuthFixture,
    photo: 'profile',
  },
  ...['en', 'sv'].map((locale) => ({
    name: locale === 'en' ? 'photo-sheet-guest' : 'photo-sheet-sv-guest',
    path: '/profile',
    testId: 'badge-sheet',
    authenticated: true,
    authFixture: guestAuthFixture,
    open: locale === 'en' ? 'Your badges' : 'Dina märken',
    locale,
    photo: 'guest',
  })),
  { name: 'settings', path: '/settings', testId: 'settings-screen', authenticated: true },
  // Development builds' test-ad row under About the app; the browser has no ads (PID-390).
  {
    name: 'settings-test-ad',
    path: '/ui-dev?state=settings',
    testId: 'app-update-section',
    testAd: true,
  },
  // PID-124: Settings → Premium only with Premium, the phone's panel and the web's line;
  // without it, a quiet Restore purchases link at the bottom.
  ...['en', 'sv'].flatMap((locale) => [
    ...['none', 'until', 'lifetime', 'restoring'].map((premium) => ({
      name: `settings-premium-${premium}-${locale}`,
      path: `/ui-dev?state=settings&fixture=premium-${premium}&locale=${locale}`,
      testId: ['none', 'restoring'].includes(premium) ? 'settings-restore' : 'settings-premium',
      locale,
      premium,
    })),
    {
      name: `settings-premium-web-${locale}`,
      path: `/ui-dev?state=settings&locale=${locale}`,
      testId: 'settings-premium',
      locale,
      premium: 'web',
      authenticated: true,
      authFixture: premiumAuthFixture,
    },
  ]),
  // PID-126: the Premium sheet over Settings, every state, with made-up store packages.
  ...['en', 'sv'].flatMap((locale) =>
    ['choose', 'buying', 'failed', 'waiting', 'bought', 'bought-ad', 'bought-guest', 'empty'].map(
      (state) => ({
        name: `premium-sheet-${state}-${locale}`,
        path: `/ui-dev?state=settings&fixture=premium-sheet-${state}&locale=${locale}`,
        testId: 'premium-sheet',
        locale,
        premiumSheet: state,
      })
    )
  ),
  // PID-119: Settings → Privacy, shown only where Google's form is required (forced here).
  ...['en', 'sv'].map((locale) => ({
    name: `settings-privacy-choices-${locale}`,
    path: `/ui-dev?state=settings&fixture=privacy-choices&locale=${locale}`,
    testId: 'settings-privacy-choices',
    privacyChoices: true,
    locale,
  })),
  ...tellCases,
  ...newsCases,
  // PID-120: the short-ad sheet before a solo game, in each state; nothing counts down.
  ...['en', 'sv'].flatMap((locale) =>
    ['offer', 'loading', 'dismissed', 'unavailable'].map((state) => ({
      name: `ad-sheet-${state}-${locale}`,
      path: `/home?fixture=ad-${state}`,
      testId: 'ad-sheet',
      authenticated: true,
      adSheet: state,
      locale,
    }))
  ),
  ...['en', 'sv'].flatMap((locale) =>
    ['update', 'image', 'news', 'ios', 'link'].map((popup) => ({
      name: `popup-${popup}-${locale}`,
      path: `/home?fixture=popup-${popup}`,
      testId: 'news-popup',
      authenticated: true,
      popup,
      locale,
    }))
  ),
  // PID-295: Marcel's welcome, and PID-316: Settings → Tell us, in both languages.
  ...['en', 'sv'].flatMap((locale) => [
    {
      name: `news-welcome-${locale}`,
      path: `/ui-dev?state=welcome&locale=${locale}`,
      testId: 'welcome-sheet',
      locale,
      welcome: true,
    },
    {
      name: `settings-feedback-${locale}`,
      path: `/ui-dev?state=settings&locale=${locale}`,
      testId: 'settings-screen',
      locale,
      feedback: true,
      // PID-348: only an account has Tell us.
      authenticated: true,
    },
    {
      name: `settings-feedback-guest-${locale}`,
      path: `/ui-dev?state=settings&locale=${locale}`,
      testId: 'settings-screen',
      locale,
      feedback: 'none',
      authenticated: true,
      authFixture: guestAuthFixture,
    },
  ]),
  // The real thing: a signed-in player who has not seen it meets it on Home.
  {
    name: 'news-welcome-home',
    path: '/home',
    testId: 'welcome-sheet',
    authenticated: true,
    welcomeUnseen: true,
    welcome: true,
  },
  ...['en', 'sv'].flatMap((locale) => [
    {
      name: `settings-pace-${locale}`,
      path: `/ui-dev?state=settings&locale=${locale}`,
      testId: 'settings-screen',
      ownPace: true,
      paceSettings: true,
    },
    {
      name: `table-pace-solo-${locale}`,
      path: `/table-dev?phase=playing&menu=pace&solo=true&locale=${locale}`,
      testId: 'table-utility-window',
      ownPace: true,
      paceSettings: true,
    },
    {
      name: `table-pace-human-${locale}`,
      path: `/table-dev?phase=playing&menu=pace&locale=${locale}`,
      testId: 'table-utility-window',
      ownPace: true,
      paceSettings: true,
    },
  ]),
  {
    name: 'update-notice',
    path: '/home?fixture=update-notice&safeArea=island',
    testId: 'home-screen',
    authenticated: true,
  },
  ...['en', 'sv'].map((locale) => ({
    name: `startup-update-${locale}`,
    path: `/ui-dev?state=updating&fixture=downloaded&locale=${locale}`,
    testId: 'updating-screen',
    locale,
    startupUpdate: true,
  })),
  ...['en', 'sv'].flatMap((locale) =>
    ['home', 'settings'].map((screen) => ({
      name: `store-update-notice-${screen}-${locale}`,
      path: `/${screen}?fixture=store-update-notice&safeArea=island`,
      testId: `${screen}-screen`,
      authenticated: true,
      storeNotice: true,
      locale,
    }))
  ),
  {
    name: 'update-notice-home-guest',
    path: '/home?fixture=update-notice&safeArea=island',
    testId: 'home-screen',
    authenticated: true,
    authFixture: guestAuthFixture,
  },
  {
    name: 'update-notice-friends-guest',
    path: '/friends?fixture=update-notice&safeArea=island',
    testId: 'auth-sheet',
    authenticated: true,
    authFixture: guestAuthFixture,
  },
  ...[
    'placed',
    '27',
    'deuce',
    'pidro',
    'small',
    'not_placed',
    'opted_out',
    'guest',
    'off',
    'rules',
    'player-sheet',
  ].flatMap((state) =>
    ['en', 'sv'].map((locale) => ({
      name: `league-${state}-${locale}`,
      path: `/league?fixture=league-${['rules', 'player-sheet'].includes(state) ? 'placed' : state}`,
      testId: 'league-screen',
      authenticated: true,
      league: state,
      locale,
    }))
  ),
  {
    name: 'league',
    path: '/league?fixture=league-placed',
    testId: 'league-screen',
    authenticated: true,
    league: 'placed',
  },
  ...['placed', 'not_placed', 'off', 'guest', 'opted_out'].map((state) => ({
    name: `league-home-${state}`,
    path: `/home?fixture=league-${state}`,
    testId: 'home-screen',
    authenticated: true,
    league: `home-${state}`,
  })),
  {
    name: 'league-profile',
    path: '/profile?fixture=league-profile',
    testId: 'profile-screen',
    authenticated: true,
    league: 'profile',
  },
  {
    name: 'league-profile-not-placed',
    path: '/profile?fixture=league-not_placed',
    testId: 'profile-screen',
    authenticated: true,
    league: 'profile-not-placed',
  },
  ...['placed', 'not_placed'].map((state) => ({
    name: `league-home-${state}-sv`,
    path: `/home?fixture=league-${state}`,
    testId: 'home-screen',
    authenticated: true,
    league: `home-${state}`,
    locale: 'sv',
  })),
  ...['profile', 'profile-not-placed'].map((state) => ({
    name: `league-${state}-sv`,
    path: `/profile?fixture=league-${state === 'profile' ? 'profile' : 'not_placed'}`,
    testId: 'profile-screen',
    authenticated: true,
    league: state,
    locale: 'sv',
  })),
  ...['en', 'sv'].map((locale) => ({
    name: `league-pin-scroll-${locale}`,
    path: '/league?fixture=league-27',
    testId: 'league-screen',
    authenticated: true,
    league: 'pin-scroll',
    locale,
  })),
  ...['en', 'sv'].flatMap((locale) =>
    ['up', 'down'].flatMap((move) =>
      [false, true].map((reducedMotion) => ({
        name: `league-home-tick-${move}-${locale}${reducedMotion ? '-reduced' : ''}`,
        path: `/home?fixture=league-home-tick-${move}`,
        testId: 'home-screen',
        authenticated: true,
        league: `home-tick-${move}`,
        homeTick: move,
        reducedMotion,
        locale,
      }))
    )
  ),
  ...['en', 'sv'].flatMap((locale) =>
    ['up', 'down', 'same', 'new', 'delayed', 'off', 'opted_out', 'guest', 'solo', 'crew'].map(
      (change) => ({
        name: `league-game-${change}-${locale}`,
        path: `/table-dev?phase=game_over&${['solo', 'crew'].includes(change) ? 'crew=win' : 'people=win'}&xp=earned&rematch=one&locale=${locale}&leagueChange=${['solo', 'crew'].includes(change) ? 'up' : change}${['guest', 'crew'].includes(change) ? '&guest=true' : ''}`,
        testId: 'game-over-window',
        authenticated: true,
        league: `game-${change}`,
        gameOver: {},
        reducedMotion: change === 'delayed',
        locale,
      })
    )
  ),
  ...['island', 'island-left', 'island-right', 'android-gesture'].map((safeArea) => ({
    name: `league-game-up-${safeArea}`,
    path: `/table-dev?phase=game_over&people=win&xp=earned&rematch=one&leagueChange=up&safeArea=${safeArea}`,
    testId: 'game-over-window',
    authenticated: true,
    league: 'game-up',
    gameOver: {},
    leagueInsets: safeArea,
  })),
  ...['en', 'sv'].map((locale) => ({
    name: `league-pin-first-partial-${locale}`,
    path: '/league?fixture=league-placed',
    testId: 'league-screen',
    authenticated: true,
    league: 'pin-first-partial',
    locale,
  })),
  ...['up', 'stayed', 'down'].flatMap((move) =>
    ['en', 'sv'].map((locale) => ({
      name: `league-result-${move}-${locale}`,
      path: `/home?fixture=league-result-${move}`,
      testId: move === 'stayed' ? 'home-screen' : 'league-result',
      authenticated: true,
      league: `result-${move}`,
      locale,
    }))
  ),
  ...['en', 'sv'].map((locale) => ({
    name: `league-result-stayed-host-${locale}`,
    path: '/home',
    testId: 'home-screen',
    authenticated: true,
    league: 'result-stayed-host',
    locale,
  })),
  ...['shelf', 'expanded'].flatMap((state) =>
    ['en', 'sv'].map((locale) => ({
      name: `league-ribbons-${state}-${locale}`,
      path: '/profile?fixture=league-ribbons',
      testId: 'profile-screen',
      authenticated: true,
      league: `ribbons-${state}`,
      locale,
    }))
  ),
  ...['friends', 'friends-not_placed', 'friends-sheet', 'friends-pin'].flatMap((state) =>
    ['en', 'sv'].map((locale) => ({
      name: `league-${state}-${locale}`,
      path: `/league?fixture=league-${['friends-sheet', 'friends-pin'].includes(state) ? 'friends' : state}`,
      testId: 'league-screen',
      authenticated: true,
      league: state,
      locale,
    }))
  ),
  ...[
    'placed',
    'not_placed',
    'opted_out',
    'guest',
    'off',
    'pending_up',
    'pending_stayed',
    'pending_down',
  ].map((state) => ({
    name: `league-sample-${state}`,
    path: `/league?fixture=league-sample-${state}`,
    testId: 'league-screen',
    authenticated: true,
    league: `sample-${state}`,
  })),
  ...['visible', 'hidden', 'confirm', 'failed', 'guest', 'off'].flatMap((state) =>
    ['en', 'sv'].map((locale) => ({
      name: `league-settings-${state}-${locale}`,
      path: '/settings',
      testId: 'settings-screen',
      authenticated: true,
      authFixture: state === 'guest' ? guestAuthFixture : authFixture,
      league: `settings-${state}`,
      locale,
    }))
  ),
  { name: 'device-settings', path: '/device-settings', testId: 'settings-screen' },
  ...[
    'list',
    'badges',
    'locked',
    'empty',
    'rejoin',
    'open',
    'substitute',
    'watch',
    'search-empty',
  ].map((fixture) => ({
    name: `lobby-${fixture}`,
    path: `/lobby?fixture=${fixture}`,
    testId: fixture === 'empty' ? 'lobby-empty' : 'lobby-screen',
    authenticated: true,
    lobbyFixture: fixture,
  })),
  ...['finnish', 'louisiana'].flatMap((ruleSet) => [
    {
      name: `settings-${ruleSet}`,
      path: `/ui-dev?state=settings&fixture=${ruleSet}`,
      testId: 'settings-screen',
      ruleSet,
      rulesSelector: 'settings-preferred-rules',
    },
    ...[false, true].map((authenticated) => ({
      name: `join-${ruleSet}-${authenticated ? 'confirm' : 'preview'}`,
      path: `/join/7KQ4M2XB?fixture=${ruleSet}`,
      testId: 'join-invite-window',
      authenticated,
      ruleSet,
      rulesBadge: 'invite-rule-set',
    })),
  ]),
  {
    name: 'join-louisiana-manual-confirm',
    path: '/join/7KQ4M2XB?source=typed&fixture=louisiana',
    testId: 'join-invite-window',
    authenticated: true,
    ruleSet: 'louisiana',
    rulesBadge: 'invite-rule-set',
  },
  {
    name: 'join-code-louisiana-confirm',
    path: '/join-code',
    testId: 'join-invite-window',
    authenticated: true,
    ruleSet: 'louisiana',
    rulesBadge: 'invite-rule-set',
    manualCode: true,
  },
  ...[
    'finnish',
    'louisiana',
    'louisiana-bidding',
    'louisiana-explainer',
    'louisiana-game-over',
    'louisiana-waiting',
    'louisiana-waiting-explainer',
  ].map((fixture) => ({
    name: `table-${fixture}`,
    path: `/table-dev?fixture=${fixture}`,
    testId: fixture.endsWith('explainer')
      ? 'rules-explainer'
      : fixture.includes('waiting')
        ? 'waiting-table'
        : fixture.endsWith('game-over')
          ? 'game-over-window'
          : 'seat-north',
    ruleSet: fixture.startsWith('louisiana') ? 'louisiana' : 'finnish',
    // Game over shows no rule set (PID-292).
    rulesBadge: fixture.includes('waiting')
      ? 'waiting-rule-set'
      : fixture.endsWith('game-over')
        ? undefined
        : 'table-rule-set',
    gameOver: fixture.endsWith('game-over') ? {} : undefined,
    rulesExplainer: fixture.endsWith('explainer'),
  })),
  { name: 'age', path: '/age?fixture=unanswered', testId: 'age-screen' },
  { name: 'age-selected', path: '/age?fixture=selected', testId: 'age-screen' },
  { name: 'age-sv', path: '/age?fixture=unanswered', testId: 'age-screen', locale: 'sv' },
  { name: 'age-stop', path: '/age?fixture=under13', testId: 'age-stop-screen' },
  { name: 'age-stop-sv', path: '/age?fixture=under13', testId: 'age-stop-screen', locale: 'sv' },
  { name: 'welcome', path: '/welcome', testId: 'welcome-window' },
  { name: 'welcome-sv', path: '/welcome', testId: 'welcome-window', locale: 'sv' },
  {
    name: 'welcome-guest',
    path: '/welcome',
    testId: 'welcome-window',
  },
  {
    name: 'welcome-invite',
    path: '/welcome',
    testId: 'welcome-window',
    pendingInvite: true,
  },
  { name: 'login', path: '/(auth)/login?fixture=providers', testId: 'auth-window' },
  { name: 'register', path: '/(auth)/register?fixture=providers', testId: 'auth-window' },
  {
    name: 'register-password',
    path: '/(auth)/register?fixture=password',
    testId: 'auth-window',
    authenticated: true,
    authFixture: guestAuthFixture,
  },
  {
    name: 'register-email-taken',
    path: '/(auth)/register?fixture=email-taken',
    testId: 'auth-window',
  },
  {
    name: 'register-name',
    path: '/(auth)/register?fixture=name-taken',
    testId: 'auth-window',
    authenticated: true,
    authFixture: guestAuthFixture,
  },
  {
    name: 'classic-method',
    path: '/(auth)/claim-classic?fixture=method',
    testId: 'claim-classic-screen',
  },
  {
    name: 'classic-preview',
    path: '/(auth)/claim-classic?fixture=preview',
    testId: 'claim-classic-screen',
    authenticated: true,
  },
  {
    name: 'classic-guest',
    path: '/(auth)/claim-classic?fixture=preview',
    testId: 'claim-classic-screen',
    authenticated: true,
    authFixture: guestAuthFixture,
  },
  {
    name: 'classic-fresh',
    path: '/(auth)/claim-classic?fixture=preview',
    testId: 'claim-classic-screen',
    yesInputs: 1,
  },
  // PID-301: signed out, Facebook with the Classic username offered claims without a step.
  {
    name: 'classic-social',
    path: '/(auth)/claim-classic?fixture=social',
    testId: 'claim-classic-screen',
    yesInputs: 0,
  },
  {
    name: 'classic-rename',
    path: '/(auth)/claim-classic?fixture=rename',
    testId: 'claim-classic-screen',
    authenticated: true,
  },
  {
    name: 'classic-conflict',
    path: '/(auth)/claim-classic?fixture=already-claimed',
    testId: 'claim-classic-screen',
    authenticated: true,
  },
  {
    name: 'classic-conflict-fresh',
    path: '/(auth)/claim-classic?fixture=already-claimed',
    testId: 'claim-classic-screen',
  },
  {
    name: 'classic-conflict-guest',
    path: '/(auth)/claim-classic?fixture=already-claimed',
    testId: 'claim-classic-screen',
    authenticated: true,
    authFixture: guestAuthFixture,
  },
  {
    name: 'classic-conflict-guest-apple',
    path: '/(auth)/claim-classic?fixture=already-claimed-apple',
    testId: 'claim-classic-screen',
    authenticated: true,
    authFixture: guestAuthFixture,
  },
  {
    name: 'classic-login',
    path: '/(auth)/claim-classic?fixture=login',
    testId: 'claim-classic-screen',
  },
  // PID-312: after two wrong passwords, the emailed-code offer above the password field.
  {
    name: 'classic-login-wrong-twice',
    path: '/(auth)/claim-classic?fixture=login-wrong-twice',
    testId: 'claim-classic-screen',
  },
  {
    name: 'classic-password',
    path: '/(auth)/claim-classic?fixture=password',
    testId: 'claim-classic-screen',
    classicPassword: true,
  },
  {
    name: 'classic-password-guest',
    path: '/(auth)/claim-classic?fixture=password',
    testId: 'claim-classic-screen',
    authenticated: true,
    authFixture: guestAuthFixture,
    classicPassword: true,
  },
  ...['en', 'sv'].flatMap((locale) =>
    ['password-reused', 'password-short'].map((fixture) => ({
      name: `classic-${fixture}-${locale}`,
      path: `/ui-dev?state=claim-classic&fixture=${fixture}&locale=${locale}`,
      testId: 'claim-classic-screen',
      locale,
      classicPasswordDecision: true,
    }))
  ),
  ...[
    'method',
    'login',
    'login-wrong-twice',
    'preview',
    'password',
    'rename',
    'already-claimed',
  ].map((fixture) => ({
    name: `locale-sv-classic-${fixture}`,
    path: `/ui-dev?state=claim-classic&fixture=${fixture}&locale=sv&language=sv`,
    testId: 'claim-classic-screen',
    locale: 'sv',
    classicPassword: fixture === 'password',
  })),
  {
    name: 'classic-rename-fresh',
    path: '/(auth)/claim-classic?fixture=rename',
    testId: 'claim-classic-screen',
  },
  ...['en', 'sv'].flatMap((locale) =>
    ['details', 'rename-details', 'taken'].map((fixture) => ({
      name: `classic-${fixture}-${locale}`,
      path: `/ui-dev?state=claim-classic&fixture=${fixture}&locale=${locale}`,
      testId: 'claim-classic-screen',
      locale,
    }))
  ),
  {
    name: 'classic-forgot',
    path: '/(auth)/classic-forgot',
    testId: 'classic-forgot-window',
  },
  {
    name: 'classic-code',
    path: '/(auth)/classic-forgot?fixture=code',
    testId: 'classic-code-window',
  },
  {
    name: 'classic-code-invalid',
    path: '/(auth)/classic-forgot?fixture=code-invalid',
    testId: 'classic-code-window',
  },
  { name: 'classic-help', path: '/(auth)/classic-help', testId: 'classic-help-window' },
  ...['en', 'sv'].flatMap((locale) => [
    ...(locale === 'sv' ? ['forgot', 'code', 'code-invalid'] : [])
      .concat(['not-found', 'unavailable'])
      .map((fixture) => ({
        name: `classic-${fixture}-${locale}`,
        path: `/(auth)/classic-forgot${fixture === 'forgot' ? '' : `?fixture=${fixture}`}`,
        testId: fixture.startsWith('code') ? 'classic-code-window' : 'classic-forgot-window',
        locale,
      })),
    ...(locale === 'sv' ? ['help', 'help-sent'] : ['help-sent']).map((fixture) => ({
      name: `classic-${fixture}-${locale}`,
      path: `/(auth)/classic-help${fixture === 'help' ? '' : '?fixture=sent'}`,
      testId: fixture === 'help' ? 'classic-help-window' : 'classic-help-sent',
      locale,
    })),
  ]),
  { name: 'auth-sheet', path: '/auth-flow-dev', testId: 'auth-flow-dev' },
  { name: 'forgot-password', path: '/(auth)/forgot-password', testId: 'auth-window' },
  {
    name: 'forgot-password-sv',
    path: '/(auth)/forgot-password',
    testId: 'auth-window',
    locale: 'sv',
  },
  {
    name: 'reset-password',
    path: '/(auth)/reset-password?token=fixture-token',
    testId: 'auth-window',
  },
  {
    name: 'reset-password-refused',
    path: '/(auth)/reset-password?token=fixture-token&fixture=refused',
    testId: 'auth-window',
  },
  { name: 'join-code', path: '/join-code', testId: 'join-code-window' },
  {
    name: 'join-invite',
    path: '/join/7KQ4M2XB?source=copy&fixture=open',
    testId: 'join-invite-window',
  },
  { name: 'ui-components', path: '/ui-dev?state=components', testId: 'ui-foundation-panel' },
  {
    name: 'ui-progression',
    path: '/ui-dev?state=progression',
    testId: 'ui-progression-panel',
  },
  { name: 'ui-avatars', path: '/ui-dev?state=avatars', testId: 'ui-avatars-panel' },
  ...['choices', 'friends', 'many', 'empty', 'sv'].map((fixture) => ({
    name: `ui-seat-picker-${fixture}`,
    path: `/ui-dev?state=seat-picker&fixture=${fixture === 'sv' ? 'friends&locale=sv' : fixture}`,
    testId: 'seat-picker-container',
  })),
  ...['setup', 'setup-open', 'opened', 'opened-more'].map((fixture) => ({
    name: `ui-seat-rows-${fixture}`,
    path: `/ui-dev?state=seat-rows&fixture=${fixture}`,
    testId: 'ui-seat-rows-panel',
  })),
  ...[
    'setup',
    'partner',
    'bots',
    'opened',
    'ready',
    'louisiana',
    'requirement',
    'password',
    'picker',
    'friends',
    'guest',
    'declined',
    'live-picker',
    'live-friends',
    'characters',
    'bot-picker',
    'bot-picker-louisiana',
    // PID-418: the waiting room's talk at rest; folded rows are not a team layout.
    'talk',
    // PID-420: bots in the other three seats: no field or faces, the quiet line instead.
    'talk-bots',
  ].map((fixture) => ({
    name: `new-table-${fixture}`,
    path: `/ui-dev?state=new-table&fixture=${fixture}`,
    testId:
      ['opened', 'ready', 'guest', 'declined'].includes(fixture) ||
      fixture.startsWith('live-') ||
      fixture.startsWith('talk')
        ? 'waiting-table'
        : 'new-table-screen',
    newTableFixture: fixture,
  })),
  ...['en', 'sv'].flatMap((language) =>
    ['reconnecting', 'ready-error', 'ready-error-unknown'].map((fixture) => ({
      name: `new-table-${fixture}-${language}`,
      path: `/ui-dev?state=new-table&fixture=${fixture}&locale=${language}`,
      testId: 'waiting-table',
      newTableFixture: fixture,
      newTableLanguage: language,
    }))
  ),
  { name: 'table-waiting', path: '/table-dev?phase=waiting', testId: 'waiting-table' },
  {
    name: 'table-waiting-notice',
    path: '/table-dev?phase=ready-host&notice=true',
    testId: 'table-feedback',
    protectNorthSeat: true,
  },
  {
    name: 'table-ready',
    path: '/table-dev?phase=ready',
    testId: 'waiting-table',
    verifyReadiness: true,
  },
  {
    name: 'table-ready-host',
    path: '/table-dev?phase=ready-host',
    testId: 'waiting-table',
    verifyReadiness: true,
  },
  {
    name: 'table-waiting-host',
    path: '/table-dev?phase=waiting-host',
    testId: 'waiting-table',
  },
  {
    name: 'table-invite',
    path: '/table-dev?phase=waiting-host&invite=true',
    testId: 'invite-window',
  },
  // PID-294: the turn light is the only light at the table; each name, and the
  // score's labels, are in their team's colour. A spectator sees N/S as us.
  {
    name: 'table-playing',
    path: '/table-dev?phase=playing',
    testId: 'seat-north',
    teams: 'player',
  },
  {
    name: 'table-teams-spectator',
    path: '/table-dev?phase=playing&role=spectator',
    testId: 'seat-north',
    teams: 'spectator',
  },
  // PID-383: the partner's line in the first hand only, and the sheet's line
  // (PID-387 took the faces off the plaque). Mia has initials, Antti is the
  // drawn bot, Marcel has a photo, Eli none.
  ...['en', 'sv'].flatMap((locale) => {
    const sv = locale === 'sv';
    const view = (name) => (sv ? `Visa profilen för ${name}, ` : `View ${name}’s profile, `);
    const at = (fixture, rest = '') => `/table-dev?fixture=${fixture}&locale=${locale}${rest}`;
    return [
      { name: `table-teams-${locale}`, path: at('teams'), partnerLine: true },
      { name: `table-teams-hand2-${locale}`, path: at('teams-hand2'), partnerLine: false },
      {
        name: `table-teams-spectator-${locale}`,
        path: at('teams', '&role=spectator'),
        partnerLine: false,
      },
      {
        name: `table-teams-sheet-partner-${locale}`,
        path: at('teams'),
        open: new RegExp(`^${view('Antti')}`),
        sheet: 'bot-profile-modal',
        teamLine: sv ? 'Din partner' : 'Your partner',
      },
      {
        name: `table-teams-sheet-opponent-${locale}`,
        path: at('teams'),
        open: new RegExp(`^${view('Eli')}`),
        sheet: 'player-sheet',
        teamLine: sv ? 'Spelar mot dig' : 'Plays against you',
      },
      {
        name: `table-teams-sheet-spectator-${locale}`,
        path: at('teams', '&role=spectator'),
        open: new RegExp(`^${view('Eli')}`),
        sheet: 'player-sheet',
        teamLine: null,
      },
    ].map((testCase) => ({
      testId: testCase.sheet ?? 'seat-north',
      authenticated: !!testCase.sheet,
      teamCase: true,
      locale,
      ...testCase,
    }));
  }),
  ...['right', 'left', 'middle'].map((position) => ({
    name: `table-play-${position}`,
    path: `/table-dev?fixture=play-motion&autoplay=false&play=${position}${position === 'left' ? '&reply=burst' : ''}`,
    testId: 'seat-north',
    playPosition: position,
  })),
  // PID-331: with the server's trick pause at 0, a finished trick stays put.
  {
    name: 'table-trick-stays',
    path: '/table-dev?fixture=play-motion&autoplay=false&transition=0',
    testId: 'seat-north',
    trickStays: true,
  },
  ...['north', 'east', 'south', 'west', 'reduced'].map((winner) => ({
    name: `table-motion-${winner}`,
    path: `/table-dev?fixture=play-motion&autoplay=false&sweep=${winner === 'reduced' ? 'west' : winner}`,
    testId: 'seat-north',
    sweepWinner: winner === 'reduced' ? 'west' : winner,
    reducedMotion: winner === 'reduced',
  })),
  {
    name: 'table-notice',
    path: '/table-dev?phase=playing&feedback=notice',
    testId: 'table-feedback',
    protectNorthSeat: true,
  },
  {
    name: 'table-reconnecting-banner',
    path: '/table-dev?phase=playing&role=player&connection=lost',
    testId: 'connection-banner',
    protectNorthSeat: true,
  },
  ...['en', 'sv'].flatMap((locale) =>
    [
      'offline',
      'auto-card',
      'auto-pass',
      'auto-bid',
      'late-card',
      'late-tap',
      'away-one',
      'away-out',
      'early-tap',
      'out-tap',
      'spectator',
    ].map((state) => ({
      name: `table-flaky-${state}-${locale}`,
      path: `/table-dev?phase=playing&fixture=flaky-${state}&role=${state === 'spectator' ? 'spectator' : 'player'}&locale=${locale}${state.endsWith('-out') || state === 'out-tap' ? '&out=you' : ''}${state.endsWith('-out') || state === 'early-tap' || state === 'out-tap' ? '&botTurn=north' : ''}`,
      locale,
      testId:
        state === 'offline'
          ? 'connection-banner'
          : state === 'spectator'
            ? 'seat-south-cards'
            : state === 'early-tap' || state === 'out-tap'
              ? 'seat-north'
              : 'table-feedback',
      flaky: state,
    }))
  ),
  // PID-364: with reduced motion the card holds still; the seat on turn still lights.
  {
    name: 'table-flaky-early-tap-reduced',
    path: '/table-dev?phase=playing&fixture=flaky-early-tap&role=player&locale=en&botTurn=north',
    locale: 'en',
    testId: 'seat-north',
    flaky: 'early-tap',
    reducedMotion: true,
  },
  ...['island-left', 'island-right'].map((safeArea) => ({
    name: `table-playing-${safeArea}`,
    path: `/table-dev?phase=playing&safeArea=${safeArea}`,
    testId: 'seat-north',
    sideInsets: safeArea === 'island-left' ? { left: 59, right: 0 } : { left: 0, right: 59 },
  })),
  {
    name: 'table-seats-reconnecting',
    path: '/table-dev?phase=playing&lifecycle=reconnecting',
    testId: 'seat-north',
  },
  {
    name: 'table-seats-bot',
    path: '/table-dev?phase=playing&lifecycle=bot_substitute',
    testId: 'seat-north',
  },
  {
    name: 'table-dealer-selection',
    path: '/table-dev?phase=dealer_selection',
    testId: 'seat-north',
    verifyDealerCutCards: true,
    levels: true,
  },
  // PID-302: a phone 1.5 s behind the server shows the cut's winner before the
  // server deals, and a bid made during its deal lands the deal at once.
  {
    name: 'table-dealer-late',
    path: '/table-dev?phase=bidding&role=player&fixture=dealer-late&late=1500',
    testId: 'seat-north',
    verifyCatchUp: true,
  },
  // PID-302: a phone still decoding the cards shows a quiet bar in the notice slot.
  {
    name: 'table-loading',
    path: '/table-dev?phase=bidding&role=player&loading=0.4',
    testId: 'table-loading',
  },
  {
    name: 'table-completed-trick',
    // With count help on, the trick's winning card keeps its glow (PID-230).
    path: '/table-dev?phase=playing&autoplay=true&count=on',
    testId: 'seat-north',
    verifyPlayedCardPersistence: true,
  },
  // PID-219: a trick holding a five pops "Pidro!"; a hand ends with its result.
  // PID-230: "Us +6" in our colour, "Them +5 · Wynn" in theirs (PID-294); every
  // "+N" (the 2 of trump's too) in its team's colour, without the winning-card
  // glow that count help adds.
  {
    name: 'table-trick-pidro',
    path: '/table-dev?phase=playing&signals=pidro&autoplay=true&count=on',
    testId: 'trick-pop-pidro-ours',
  },
  {
    name: 'table-trick-pidro-theirs',
    path: '/table-dev?phase=playing&signals=pidro-theirs&autoplay=true&count=on',
    testId: 'trick-pop-pidro-theirs',
  },
  {
    name: 'table-trick-points',
    path: '/table-dev?phase=playing&signals=points&autoplay=true&count=on',
    testId: 'trick-pop-ours',
  },
  {
    name: 'table-trick-points-theirs',
    path: '/table-dev?phase=playing&signals=points-theirs&autoplay=true&count=on',
    testId: 'trick-pop-theirs',
  },
  // PID-236: the table dims under the hand's result and the point cards each
  // team took; ours made is stamped gold, the rest is quiet.
  { name: 'table-hand-made', path: '/table-dev?phase=playing&hand=made', testId: 'hand-result' },
  {
    name: 'table-hand-own',
    path: '/table-dev?phase=playing&hand=own',
    testId: 'hand-continue',
    ownPace: true,
  },
  {
    name: 'table-hand-own-sv',
    path: '/table-dev?phase=playing&hand=own&locale=sv',
    testId: 'hand-continue',
    ownPace: true,
  },
  {
    name: 'table-hand-own-retry',
    path: '/table-dev?phase=playing&hand=own&reply=continue',
    testId: 'hand-continue',
    ownPace: true,
  },
  ...['en', 'sv'].map((locale) => ({
    name: `table-hand-own-missed-${locale}`,
    path: `/table-dev?phase=playing&hand=own-missed&locale=${locale}`,
    testId: 'hand-continue',
    ownPace: true,
  })),
  {
    name: 'table-hand-sweep-spectator',
    path: '/table-dev?fixture=all-14&viewer=spectator',
    testId: 'hand-result',
    ownPace: true,
  },
  { name: 'table-hand-set', path: '/table-dev?phase=playing&hand=set', testId: 'hand-result' },
  // PID-332: count help off, a hand ends as Classic's did. Our missed 10 and
  // their 6 between the hand's 16 cards; then, at own pace, our made 8 and
  // their 6 alone over the trump mark, waiting for a tap.
  {
    name: 'table-hand-classic',
    path: '/table-dev?deal=hand&end=we-missed&showMs=600000',
    testId: 'hand-points',
    classicEnd: { us: '−10', them: '6', played: 16 },
  },
  {
    name: 'table-hand-classic-alone',
    path: '/table-dev?deal=hand&end=we-made&pace=own&showMs=0',
    testId: 'hand-points-continue',
    classicEnd: { us: '8', them: '6', played: 0, own: true },
  },
  // PID-366: one player alone holds trumps and the server settles the hand.
  // Their trumps lie face up in a fan in front of their seat (yours rise from
  // your hand), with the points on it under count help; the result waits.
  // Every seat, with two and five cards, count help on and off, EN and SV.
  ...[
    ['north', 5, true, 'en'],
    ['north', 2, false, 'sv'],
    ['east', 5, false, 'sv'],
    ['east', 2, true, 'en'],
    ['west', 2, false, 'en'],
    ['west', 5, true, 'sv'],
    ['south', 5, true, 'en'],
    ['south', 2, false, 'sv'],
  ].map(([rel, cards, count, locale]) => ({
    name: `table-lay-down-${rel}-${cards}${count ? '-count' : ''}-${locale}`,
    path: `/table-dev?fixture=lay-down&by=${rel}&cards=${cards}${count ? '&count=on' : ''}&locale=${locale}`,
    testId: `lay-down-${rel}`,
    layDown: { rel, cards, count, sv: locale === 'sv' },
  })),
  {
    name: 'table-hand-they-set',
    path: '/table-dev?phase=playing&hand=they-set',
    testId: 'hand-result',
  },
  // PID-221: the ticker at its fullest, long names included, stays clear of the
  // plaque and the North seat; the hand log opens from it. Small and landscape
  // phones leave the ticker out (PID-229, PID-305).
  {
    name: 'table-ticker',
    path: '/table-dev?phase=playing&ticker=full&names=long&count=on',
    testId: 'ticker-line-bid-4-south',
    protectNorthSeat: true,
    skipViewports: ['landscape', 'small-landscape', 'compact-landscape'],
  },
  // PID-232: a 32-character name in every seat, North dealing, truncates
  // inside its seat, clear of the other seats and the hand.
  {
    name: 'table-long-names',
    path: '/table-dev?phase=playing&names=max&dealer=north',
    testId: 'seat-south',
    longNames: true,
  },
  // A 640×360 Android phone with a 59pt right inset, North dealing: North's
  // fan moves left, so its name keeps its first letters.
  {
    name: 'table-long-names-inset',
    path: '/table-dev?phase=playing&names=max&dealer=north&safeArea=island-right',
    testId: 'seat-south',
    longNames: true,
    northNameMin: 76,
    protectNorthSeat: true,
    skipViewports: ['portrait', 'landscape', 'compact-landscape'],
  },
  {
    name: 'table-hand-log',
    path: '/table-dev?phase=playing&count=on',
    openLog: true,
    testId: 'hand-log-entry-trump-4',
    skipViewports: ['compact-landscape'],
  },
  {
    name: 'table-bidding',
    path: '/table-dev?phase=bidding',
    testId: 'bidding-window',
    protectNorthSeat: true,
    protectPlayerHand: true,
  },
  // PID-214: against three bots, every seat keeps its bid and the high bid is
  // named, on the small phones that leave the ticker out too. `high`: you hold
  // it, and your tight seat says so under its avatar.
  {
    name: 'table-bid-round',
    path: '/table-dev?phase=bidding&role=player&bids=round',
    testId: 'bidding-window',
    protectNorthSeat: true,
    protectPlayerHand: true,
    bidLines: { west: 'Passed', north: 'Bid 7', east: 'Bid 9 · high' },
    crew: { west: 'Marcel', north: 'Antti', east: 'Jocke' },
    viewports: { 'compact-landscape': { width: 640, height: 360 } },
  },
  {
    name: 'table-bid-high',
    path: '/table-dev?phase=bidding&role=player&bids=high',
    testId: 'seat-south',
    bidLines: { north: 'Bid 7', east: 'Passed', south: 'Bid 9 · high' },
    viewports: { 'compact-landscape': { width: 640, height: 360 } },
  },
  ...['north', 'east', 'south', 'west'].map((seat) => ({
    name: `table-details-${seat}`,
    path: `/table-dev?fixture=details&bidder=${seat}`,
    testId: `seat-${seat}-bid`,
    details: seat,
  })),
  {
    name: 'table-details-bidding',
    path: '/table-dev?fixture=details&phase=bidding',
    testId: 'bidding-window',
    details: 'bidding',
  },
  ...['declaring', 'second_deal', 'game_over'].map((phase) => ({
    name: `table-details-${phase}`,
    path: `/table-dev?fixture=details&phase=${phase}`,
    testId:
      phase === 'game_over'
        ? 'game-over-overlay'
        : `seat-${phase === 'declaring' ? 'south' : 'east'}-bid`,
    details: phase === 'game_over' ? 'ended' : phase === 'declaring' ? 'south' : 'east',
    detailsPhase: phase,
  })),
  // PID-338: the six players of Status-Seats over the four seats, Bengt dealing
  // and Aino holding the bid at 9; measured on every table layout.
  // The chips show at the cut (PID-334 hides them during a hand), so the cut
  // measures the chips and the hand measures the dealer and the bid.
  ...['a', 'b'].flatMap((seats) => [
    {
      name: `table-status-${seats}`,
      path: `/table-dev?fixture=status&role=player&seats=${seats}`,
      testId: 'seat-north-bid',
      statusSeats: seats,
    },
    {
      name: `table-status-${seats}-cut`,
      path: `/table-dev?fixture=status&role=player&seats=${seats}&cut=true`,
      testId: 'seat-north',
      statusSeats: seats,
      statusCut: true,
    },
  ]),
  // PID-304: small phones, from Marcel's TCL. ironman3001 deals at West and a
  // long North name holds the bid in one; no seat may touch a played card,
  // or your hand, and every corner keeps its one meaning.
  ...[
    ['west-deals', 'fixture=details&dealer=west&bidder=east', { dealer: 'west', bidder: 'east' }],
    ['north-bid', 'fixture=details&dealer=west&bidder=north', { dealer: 'west', bidder: 'north' }],
    [
      'your-turn',
      'phase=playing&role=player&trick=bots',
      { dealer: 'north', bidder: 'east', played: 3 },
    ],
  ].map(([name, query, smallTable]) => ({
    name: `table-small-${name}`,
    path: `/table-dev?${query}&names=long&count=on`,
    testId: 'seat-south',
    smallTable,
  })),
  // PID-305, PID-307: landscape phones lay the table out as Classic does,
  // each hand along its edge and the played cards on a cross around the
  // trump mark, every thing TRICK_GAP from every other. ironman3001 deals at
  // West, Margaretha Lindqvist holds the bid.
  ...[
    [
      'bidding',
      'fixture=details&dealer=west&bidder=north&phase=bidding',
      'bidding-window',
      { pack: true },
    ],
    // PID-394: the pack rests beside its dealer, North's left of its fan.
    ['bidding-north', 'phase=bidding&role=player&dealer=north', 'bidding-window', { pack: true }],
    ['bidding-east', 'phase=bidding&role=player&dealer=east', 'bidding-window', { pack: true }],
    [
      'second-deal-east',
      'deal=draw&dealer=east&holdMs=600000',
      'seat-south',
      { thrown: ['south', 'west', 'north'], mark: true, pack: true },
    ],
    [
      'second-deal-north',
      'deal=draw&dealer=north&holdMs=600000',
      'seat-south',
      { thrown: ['east', 'south', 'west'], mark: true, pack: true },
    ],
    // The piles hold until captured: a 3 s hold races the still capture.
    // A throw is backs for everyone, the thrower too (PID-307).
    [
      'second-deal',
      'deal=draw&holdMs=600000',
      'seat-south',
      { thrown: ['north', 'east', 'south'], mark: true, pack: true },
    ],
    // PID-306: only the dealer sees their own throw; everyone sees killed trumps.
    [
      'dealer-throws',
      'deal=draw&dealerHoldMs=600000',
      'seat-south',
      { thrown: ['west'], mark: true },
    ],
    [
      'you-deal',
      'deal=draw&you=deal&dealerHoldMs=600000',
      'seat-south',
      { thrown: ['south'], faces: { south: 2 }, mark: true },
    ],
    [
      'kill',
      'deal=draw&kill=1&holdMs=100&dealerHoldMs=100&cardMs=10',
      'seat-south',
      { killed: ['east'], mark: true },
    ],
    ['trick', 'phase=playing&role=player&trick=full', 'seat-south', { played: 4, mark: true }],
    // Two tricks taken: all twelve cards stay, the first eight trailing (PID-308).
    ['third', 'phase=playing&role=player&trick=third', 'seat-south', { played: 12, mark: true }],
    // East has led the third: the others' cards wait on the cross, shaded (PID-308).
    ['turning', 'phase=playing&role=player&trick=turning', 'seat-south', { played: 9, mark: true }],
    // East kept seven trumps and put two cards into the first trick.
    ['seven', 'phase=playing&role=player&trick=seven', 'seat-south', { played: 5, mark: true }],
    // Five tricks: each side's four earlier cards trail toward its index, up
    // West's column and down East's, closing up short of the seats (PID-388).
    ['piles-5', 'fixture=piles&cards=5', 'seat-south', { played: 20, mark: true }],
    ['hand-end', 'deal=hand', 'hand-result-panel', { result: true }],
  ].map(([name, query, testId, twoRows]) => ({
    name: `table-two-rows-${name}`,
    path: `/table-dev?${query}&names=long&count=on`,
    testId,
    twoRows,
    ...(name === 'trick' && { levels: false }),
  })),
  // PID-333: upright phones draw cards as big as Classic's. Nothing on the
  // table touches anything else, and the card heights print in dp; PID-393
  // prints where East and West sit against the trick's line.
  ...[
    ['bidding', 'phase=bidding', 'bidding-window', {}],
    [
      'second-deal',
      'deal=draw&holdMs=600000',
      'seat-south',
      { thrown: ['north', 'east', 'south'], mark: true, pack: true },
    ],
    // PID-394: the pack rests beside its dealer through bidding and the throws.
    ['bidding-north', 'phase=bidding&role=player&dealer=north', 'bidding-window', { pack: true }],
    ['bidding-east', 'phase=bidding&role=player&dealer=east', 'bidding-window', { pack: true }],
    ['bidding-west', 'phase=bidding&role=player&dealer=west', 'bidding-window', { pack: true }],
    // Tight North's long name runs right toward East's pack and stops short of it.
    [
      'bidding-east-long',
      'phase=bidding&role=player&dealer=east&names=long',
      'bidding-window',
      { pack: true },
    ],
    [
      'second-deal-east',
      'deal=draw&dealer=east&holdMs=600000',
      'seat-south',
      { thrown: ['south', 'west', 'north'], mark: true, pack: true },
    ],
    [
      'second-deal-north',
      'deal=draw&dealer=north&holdMs=600000',
      'seat-south',
      { thrown: ['east', 'south', 'west'], mark: true, pack: true },
    ],
    [
      'second-deal-you',
      'deal=draw&you=deal&holdMs=600000',
      'seat-south',
      { thrown: ['north', 'east', 'west'], mark: true, pack: true },
    ],
    ['trick', 'phase=playing&role=player&trick=full', 'seat-south', { played: 4, mark: true }],
    // The PID-236 panel, and Classic's end: the hand's 16 cards (PID-332).
    ['hand-end', 'deal=hand&count=on', 'hand-result-panel', { result: true }],
    [
      'hand-classic',
      'deal=hand&end=we-missed&showMs=600000',
      'hand-points',
      { played: 16, ended: true },
    ],
    // PID-381: every seat's newest card in front at full size, its earlier
    // ones behind it, smaller and shaded, each rank and suit in view. At 6
    // East kept seven trumps; `led`: East alone has led, the others' last
    // cards wait; `out`: you went out, your pile has no newest card.
    ...[
      ['piles-1', 'cards=1', 4],
      ['piles-3', 'cards=3', 12],
      ['piles-5', 'cards=5', 20],
      ['piles-6', 'cards=6', 25],
      ['piles-5-count', 'cards=5&count=on', 20, { counted: true }],
      ['piles-6-count', 'cards=6&count=on', 25, { counted: true }],
      ['piles-5-led', 'cards=5&led=east', 17],
      ['piles-5-out', 'cards=5&you=out', 19, { out: 'south' }],
      // West leads the next trick: its last card settles back, or cuts there.
      ['piles-settle', 'cards=5&next=on', 21, { settle: true }],
      ['piles-settle-reduced', 'cards=5&next=on', 21, { settle: true, reduced: true }],
    ].map(([name, query, played, piles = {}]) => [
      name,
      `fixture=piles&${query}`,
      'seat-south',
      { played, mark: true, piles, ended: !!piles.out },
    ]),
  ].map(([name, query, testId, upright]) => ({
    name: `table-upright-${name}`,
    path: `/table-dev?${query}`,
    testId,
    upright,
    ...(upright.piles?.reduced && { reducedMotion: true }),
  })),
  // PID-267: the bots bid while the cards are still being dealt. Until the
  // deal ends no seat and no log line shows a bid; then all three show.
  {
    name: 'table-bid-during-deal',
    path: '/table-dev?phase=bidding&role=player&deal=true&bids=round&count=on',
    testId: 'bidding-window',
    dealHold: true,
    bidLines: { west: 'Passed', north: 'Bid 7', east: 'Bid 9 · high' },
    viewports: { 'compact-landscape': { width: 640, height: 360 } },
    levels: false,
  },
  // PID-220: with count help on, the plaque's bid line carries the bidders'
  // count and "Last trick" sits under it, clear of every seat. Tight phones
  // leave both out and open the hand's log from the score panel (PID-304).
  // Marcel is out of trumps: dimmed, "Out", the two cards folded face down.
  {
    name: 'table-count-help',
    path: '/table-dev?phase=playing&role=player&out=one&count=on',
    testId: 'seat-south',
    countHelp: { bidder: 'Jocke', line: 'bid 6', out: ['west'], folded: ['west'] },
  },
  {
    name: 'table-last-trick',
    path: '/table-dev?phase=playing&role=player&out=one&count=on',
    open: 'Last trick, trick 2',
    testId: 'last-trick-cards',
    // Tight and landscape phones have no Last trick: table-count-help opens the log there.
    skipViewports: [
      'small-portrait',
      'compact-portrait',
      'landscape',
      'small-landscape',
      'compact-landscape',
    ],
  },
  // PID-364: the server plays Eli's trumps out; his line keeps "Takes the rest"
  // between the cards, and until the hand's result shows.
  ...['en', 'sv'].map((locale) => ({
    name: `table-sweep-${locale}`,
    path: `/table-dev?deal=hand&sweep=held&count=on&locale=${locale}`,
    locale,
    testId: 'seat-east',
    sweep: 'held',
  })),
  ...['on', 'off'].map((count) => ({
    name: `table-sweep-hold-count-${count}`,
    path: `/table-dev?deal=hand&sweep=on&count=${count}&locale=en`,
    testId: 'seat-east',
    sweep: 'on',
  })),
  // Everyone else is out: the rest of the hand is yours.
  {
    name: 'table-takes-the-rest',
    path: '/table-dev?phase=playing&role=player&out=lone&count=on',
    testId: 'seat-south',
    countHelp: { out: ['north', 'east', 'west'], folded: ['east', 'west'], lone: 'south' },
  },
  ...['fold', 'fold-legacy', 'fold-reduced'].map((fixture) => ({
    name: `table-${fixture}`,
    path: `/table-dev?fixture=${fixture === 'fold-legacy' ? fixture : 'fold'}&count=on`,
    testId: 'seat-south-folded',
    fold: { north: 3, west: 2, south: 4 },
    reducedMotion: fixture === 'fold-reduced',
  })),
  ...['west', 'south'].map((seat) => ({
    name: `table-fold-trick${seat === 'south' ? '-self' : ''}`,
    path: `/table-dev?fixture=fold-trick${seat === 'south' ? '-self' : ''}&count=on`,
    testId: `seat-${seat}-folded`,
    fold: { [seat]: 2 },
    playedCount: seat === 'south' ? 4 : 2,
    completedFold: seat === 'south',
  })),
  // PID-214: a bot seat says what it played, like anyone, also on the small
  // phones where the seats wear nameplates.
  {
    name: 'table-bot-plays',
    path: '/table-dev?phase=playing&role=player&trick=bots',
    testId: 'seat-east',
    playLines: { west: 'Plays 9♥', north: 'Plays K♥', east: 'Plays 4♥' },
  },
  // PID-258: in a game with bots, a seat held for you waits at the top, clear
  // of the played cards, the hand and the bids; upright the table makes room
  // under it, so it covers no seat, the score or the menu. A phone on its side,
  // or a short upright one, has no room for the bids too: there it waits until
  // you have bid.
  {
    name: 'table-invitation',
    path: '/table-dev?phase=playing&role=player&trick=bots&invitation=partner',
    testId: 'table-invitation',
    invitation: 'Ostrobothnian · as Bertil’s partner',
  },
  {
    name: 'table-invitation-bidding',
    path: '/table-dev?phase=bidding&role=player&bids=round&invitation=opponent',
    testId: 'bidding-window',
    invitation: 'Ostrobothnian · as Bertil’s opponent',
  },
  // Upright on a notched phone: under the score and the menu, below the island.
  {
    name: 'table-invitation-island',
    path: '/table-dev?phase=playing&role=player&trick=bots&invitation=partner&safeArea=island',
    testId: 'table-invitation',
    invitation: 'Ostrobothnian · as Bertil’s partner',
    skipViewports: ['landscape', 'compact-landscape'],
  },
  ...['island-left', 'island-right'].map((safeArea) => ({
    name: `table-invitation-${safeArea}`,
    path: `/table-dev?phase=playing&role=player&trick=bots&invitation=rules&safeArea=${safeArea}`,
    testId: 'table-invitation',
    invitation: 'Ostrobothnian',
    skipViewports: ['portrait'],
    insets: safeArea === 'island-left' ? { left: 59, right: 0 } : { left: 0, right: 59 },
  })),
  // PID-209: you dealt and won the bid. The suits sit in the felt, none
  // picked for you and nothing lifted yet; every seat stays in view.
  {
    name: 'table-trump',
    path: '/table-dev?phase=declaring',
    testId: 'trump-picker',
    protectNorthSeat: true,
  },
  {
    name: 'table-hand-selection',
    path: '/table-dev?phase=second_deal&role=player&dealer=south',
    testId: 'hand-selection-window',
    protectNorthSeat: true,
    verifyDealerSelection: true,
  },
  {
    name: 'table-dealer-waiting',
    path: '/table-dev?phase=second_deal&role=player&dealer=north',
    testId: 'seat-north',
    verifyDealerOnTable: true,
  },
  {
    name: 'table-automatic-dealer-rob',
    path: '/table-dev?phase=auto_rob&role=player&dealer=south',
    testId: 'seat-south',
    verifyDealerOnTable: true,
  },
  // PID-237: the win reveal, the loss that opens on your best hand, and the
  // rematch row in each state, seen from south with Nora as partner.
  {
    name: 'table-game-over',
    path: '/table-dev?phase=game_over&xp=earned&rematch=one',
    testId: 'game-over-window',
    viewports: GAME_OVER_TABLETS,
    gameOver: {
      headline: 'You and Nora win',
      title: 'Nora wants a rematch',
      detail: 'Waiting for Eli and Wynn',
      parts: ['how-it-went', 'streak-chip', 'xp-chip'],
    },
  },
  {
    name: 'table-game-over-loss',
    path: '/table-dev?phase=game_over&result=loss&xp=earned&rematch=two',
    testId: 'game-over-window',
    gameOver: {
      headline: 'Eli and Wynn win',
      title: 'Nora and Eli want a rematch',
      detail: 'Waiting for Wynn',
      parts: ['best-hand', 'every-hand', 'xp-chip'],
      absent: ['how-it-went', 'streak-chip', 'victory-rays'],
      smallPhone: { absent: ['xp-chip'], noText: 'Game over · 10 hands' },
    },
  },
  {
    name: 'table-game-over-spectator',
    path: '/table-dev?phase=game_over&result=spectator&xp=earned',
    testId: 'game-over-window',
    gameOver: {
      headline: 'Alex and Nora win',
      parts: ['how-it-went'],
      absent: ['play-again', 'rematch-status', 'streak-chip', 'xp-chip', 'best-hand'],
    },
  },
  // PID-292: a guest against the bot crew (Marcel's game in JA36) and an
  // account with people. Bots always agree, so their game shows no rematch row.
  {
    name: 'table-game-over-guest-win',
    path: '/table-dev?phase=game_over&guest=true&crew=win',
    testId: 'game-over-window',
    viewports: GAME_OVER_TABLETS,
    gameOver: {
      headline: 'You and Jocke win',
      eyebrow: 'The winning trick',
      plaque: 'All 14 in hand 5',
      parts: ['game-over-trick', 'every-hand', 'guest-save'],
      absent: ['rematch-status', 'how-it-went', 'streak-chip', 'xp-chip'],
    },
  },
  {
    name: 'table-game-over-guest-loss',
    path: '/table-dev?phase=game_over&guest=true&crew=loss',
    testId: 'game-over-window',
    viewports: GAME_OVER_TABLETS,
    gameOver: {
      headline: 'Marcel and Antti win',
      parts: ['best-hand', 'every-hand', 'guest-save'],
      absent: ['rematch-status', 'how-it-went', 'victory-rays'],
    },
  },
  // Games with people (PID-292): the rematch row stays, a loss links to every
  // hand under its best hand, and a small phone's loss drops the eyebrow and XP.
  {
    name: 'table-game-over-online-win',
    path: '/table-dev?phase=game_over&people=win&xp=earned&rematch=one',
    testId: 'game-over-window',
    viewports: GAME_OVER_TABLETS,
    gameOver: {
      headline: 'You and Nora win',
      title: 'Nora wants a rematch',
      detail: 'Waiting for Kalle and Mikko',
      plaque: 'Bid 9 · won 11',
      parts: ['how-it-went', 'xp-chip', 'game-over-trick'],
      // A small phone keeps the chart and the rematch row; the card and its plaque give way.
      smallPhone: { absent: ['game-over-trick'], noText: 'Bid 9 · won 11' },
      absent: ['streak-chip', 'best-hand', 'guest-save'],
    },
  },
  {
    name: 'table-game-over-online-loss-in',
    path: '/table-dev?phase=game_over&people=loss&xp=earned&rematch=in',
    testId: 'game-over-window',
    viewports: GAME_OVER_TABLETS,
    gameOver: {
      headline: 'Bengt and Nora win',
      eyebrow: 'Game over · 9 hands',
      title: "You're in",
      detail: 'Waiting for Bengt and Nora',
      waiting: true,
      seats: 4,
      parts: ['best-hand', 'every-hand', 'xp-chip'],
      absent: ['how-it-went', 'victory-rays', 'guest-save'],
      smallPhone: { absent: ['xp-chip'], noText: 'Game over · 9 hands' },
    },
  },
  {
    name: 'table-game-over-online-loss',
    path: '/table-dev?phase=game_over&people=loss&xp=earned&rematch=one',
    testId: 'game-over-window',
    viewports: GAME_OVER_TABLETS,
    gameOver: {
      headline: 'Bengt and Nora win',
      title: 'Mikko wants a rematch',
      detail: 'Waiting for Bengt and Nora',
      seats: 3,
      parts: ['best-hand', 'every-hand', 'xp-chip'],
      absent: ['how-it-went', 'victory-rays'],
      smallPhone: { absent: ['xp-chip'], noText: 'Game over · 9 hands' },
    },
  },
  {
    name: 'table-game-over-rematch-waiting',
    path: '/table-dev?phase=game_over&rematch=waiting',
    testId: 'rematch-status',
    gameOver: { title: "You're in", detail: 'Waiting for Nora, Eli and Wynn', waiting: true },
  },
  {
    name: 'table-game-over-rematch-asked',
    path: '/table-dev?phase=game_over&rematch=asked',
    testId: 'rematch-status',
    gameOver: { title: 'Nora, Eli and Wynn want a rematch', detail: 'Waiting for you' },
  },
];

const localizationCases = ['en', 'sv'].flatMap((locale) => [
  ...[
    ['header', '/table-dev?fixture=finnish', 'table-rule-set'],
    ['settings', '/ui-dev?state=settings&fixture=finnish', 'settings-preferred-rules'],
    ['pills', '/ui-dev?state=new-table&fixture=setup', 'new-table-screen'],
    ['bots', '/table-dev?fixture=finnish&phase=ready-solo', 'waiting-table'],
    ['loss', '/table-dev?phase=game_over&result=loss', 'game-over-window'],
    ['lobby', '/ui-dev?state=lobby-seats', 'lobby-table-SAMPLE0'],
  ].map(([words, path, testId]) => ({
    name: `words-${locale}-${words}`,
    path: `${path}&locale=${locale}`,
    testId,
    locale,
    words,
  })),
  // Settings → About the app names the running update (PID-265).
  ...['named', 'embedded', 'fallback'].map((fixture) => ({
    name: `locale-${locale}-settings-update-${fixture}`,
    path: `/ui-dev?state=settings&fixture=update-${fixture}&locale=${locale}&language=${locale}`,
    testId: 'app-update-section',
    locale,
    appUpdate: fixture,
  })),
  ...['en', 'sv'].map((language) => ({
    name: `locale-${locale}-settings-${language}`,
    path: `/ui-dev?state=settings&locale=${locale}&language=${language}`,
    testId: 'settings-screen',
    locale,
    language,
  })),
  ...[
    ['bidding', 'bidding', 'bidding-window'],
    ['trump', 'declaring', 'trump-picker'],
    ['hand-selection', 'second_deal&role=player&dealer=south', 'hand-selection-window'],
    ['game-over', 'game_over', 'game-over-window'],
    ['dealer', 'dealer_selection', 'seat-north'],
    ['playing', 'playing', 'seat-north'],
  ].map(([name, phase, testId]) => ({
    name: `locale-${locale}-${name}`,
    path: `/table-dev?phase=${phase}&locale=${locale}&language=${locale}`,
    testId,
    locale,
    protectNorthSeat: ['bidding', 'trump', 'hand-selection'].includes(name),
  })),
  {
    name: `locale-${locale}-waiting`,
    path: `/ui-dev?state=new-table&fixture=opened&locale=${locale}&language=${locale}`,
    testId: 'waiting-table',
    locale,
  },
]);
allCases.push(...localizationCases);
allCases.push(
  ...allCases
    .filter((testCase) => testCase.bidLines)
    .map((testCase) => ({
      ...testCase,
      name: `locale-sv-${testCase.name}`,
      path: `${testCase.path}&locale=sv`,
      locale: 'sv',
      bidLines: testCase.name.endsWith('-high')
        ? { north: 'Bud 7', east: 'Passat', south: 'Bud 9 · högst' }
        : { west: 'Passat', north: 'Bud 7', east: 'Bud 9 · högst' },
    }))
);
allCases.push(
  ...allCases
    .filter((testCase) => testCase.countHelp)
    .map((testCase) => ({
      ...testCase,
      name: `locale-sv-${testCase.name}`,
      path: `${testCase.path}&locale=sv`,
      locale: 'sv',
      countHelp: {
        ...testCase.countHelp,
        ...(testCase.countHelp.line && { line: 'bjöd 6' }),
        words: { out: 'ute', lone: 'tar resten' },
      },
    }))
);
allCases.push(
  ...allCases
    .filter(
      (testCase) => testCase.name.startsWith('friends-') || testCase.name.startsWith('blocked-')
    )
    .map((testCase) => {
      const path = new URL(testCase.path, baseUrl);
      return {
        ...testCase,
        name: `locale-sv-${testCase.name}`,
        path: `/ui-dev?state=${path.pathname.slice(1)}&fixture=${path.searchParams.get('fixture') ?? ''}&locale=sv&language=sv${path.searchParams.get('from') === 'profile' ? '&from=profile' : ''}`,
        locale: 'sv',
        open: testCase.open ? 'Visa profilen för Nora' : undefined,
      };
    })
);

async function assertLocalization(page, testCase, viewport) {
  if (!testCase.locale) return;
  if (testCase.words) {
    const sv = testCase.locale === 'sv';
    const label = sv ? 'Österbottnisk' : 'Ostrobothnian';
    const target = page.getByTestId(testCase.testId);
    if (testCase.words === 'header') {
      assert.equal(await target.getAttribute('aria-label'), label);
    } else if (!['bots', 'loss'].includes(testCase.words)) {
      await target.getByText(label, { exact: true }).first().waitFor();
    }
    if (['pills', 'bots'].includes(testCase.words)) {
      await assertTeamLayout(page, viewport, testCase.name);
      for (const team of sv ? ['Vi', 'De'] : ['Us', 'Them'])
        await target.getByText(team, { exact: true }).waitFor();
    }
    if (testCase.words === 'bots')
      assert.equal(
        await page.getByTestId('waiting-rule-set').innerText(),
        `${sv ? 'Snabbspel' : 'Quick game'} · ${label}`
      );
    if (testCase.words === 'loss') {
      for (const team of sv ? ['Vi', 'De'] : ['Us', 'Them'])
        await target.getByText(team, { exact: true }).waitFor();
    }
    if (testCase.words === 'lobby') {
      const gaps = await page.getByTestId(/^room-rules-/).evaluateAll((badges) =>
        badges.map((badge) => {
          const status = badge.parentElement.nextElementSibling;
          return status.getBoundingClientRect().left - badge.getBoundingClientRect().right;
        })
      );
      assert.equal(gaps.length, 3);
      assert.ok(
        gaps.every((gap) => gap >= 8),
        `${testCase.name}: rule badge crowds seat count`
      );
    }
    const flag = target.locator('svg[viewBox="0 0 18 12"]').first();
    if (['header', 'settings'].includes(testCase.words)) {
      assert.equal(await flag.locator('rect').first().getAttribute('fill'), '#d21034');
      assert.equal(await flag.locator('path').first().getAttribute('fill'), '#ffce00');
    }
  }
  const clipped = await page.locator('[dir="auto"]').evaluateAll((nodes) =>
    nodes
      .filter((node) => node.getBoundingClientRect().width && node.getClientRects().length)
      // Public player names and catalogue lines (PID-405) deliberately ellipsize; localized
      // sentences may not.
      .filter(
        (node) =>
          ![
            'Alexandria the Long-Named Player',
            'AlexandriaLongName',
            'Hmmm… nå… jaha… tja… hmm… nå… jaha… tja…',
          ].includes(node.textContent)
      )
      .filter(
        (node) =>
          getComputedStyle(node).overflow === 'hidden' &&
          (node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1)
      )
      .map((node) => node.textContent)
  );
  assert.deepEqual(clipped, [], `${testCase.name}: clipped natural text in ${viewport.name}`);
  if (testCase.locale === 'sv') {
    const expected = testCase.language
      ? 'Språk'
      : testCase.name.endsWith('-trump')
        ? // The shortest phones drop "Välj trumf" (PID-304); the suits still speak Swedish.
          'Hjärter'
        : testCase.name.endsWith('-hand-selection')
          ? 'Välj din hand'
          : null;
    if (expected) await page.getByText(expected, { exact: true }).waitFor();
  }
  if (testCase.language) {
    const group = page.getByTestId('settings-language');
    const labels = ['English', 'Svenska'];
    const selected = ['en', 'sv'].indexOf(testCase.language);
    const groupBox = await group.boundingBox();
    // Two choices, no device language, one of them always chosen, side by side.
    assert.equal(await group.getByRole('radio').count(), 2);
    const boxes = [];
    for (const [index, label] of labels.entries()) {
      const radio = group.getByRole('radio', { name: label, exact: true });
      const box = await radio.boundingBox();
      assert.ok(box.height >= 48, `${label}: 48pt target`);
      assert.ok(
        box.x >= groupBox.x && box.x + box.width <= groupBox.x + groupBox.width,
        `${label}: radio must stay within the language Surface`
      );
      assert.equal(await radio.getAttribute('aria-checked'), String(index === selected));
      boxes.push(box);
    }
    assert.ok(Math.abs(boxes[0].y - boxes[1].y) < 1, 'English and Svenska side by side');
    assert.equal(await page.getByText(/System language|Enhetens språk/).count(), 0);
    const before = await page.evaluate(() => localStorage.getItem('settings-storage'));
    await group.getByRole('radio', { name: 'Svenska', exact: true }).click();
    await group.getByText('Språk', { exact: true }).waitFor();
    await group.getByRole('radio', { name: 'English', exact: true }).click();
    await group.getByText('Language', { exact: true }).waitFor();
    await group.getByRole('radio', { name: 'English', exact: true }).press('ArrowRight');
    await group.getByText('Språk', { exact: true }).waitFor();
    assert.equal(
      await group.getByRole('radio', { name: 'Svenska', exact: true }).getAttribute('aria-checked'),
      'true'
    );
    assert.equal(await page.evaluate(() => localStorage.getItem('settings-storage')), before);
    // Normal screens must ignore even a complete fixture override query.
    await page.goto(`${baseUrl}/device-settings?locale=sv&language=sv`);
    await page.getByTestId('settings-language').getByText('Language', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('settings-storage')), before);
  }
}

function selectCases() {
  if (requestedCases.size === 0) return allCases;

  const knownCases = new Set(allCases.map(({ name }) => name));
  const unknownCases = [...requestedCases].filter((name) => !knownCases.has(name));
  if (unknownCases.length) {
    throw new Error(
      `Unknown UI_CASES: ${unknownCases.join(', ')}. Choose from: ${[...knownCases].join(', ')}`
    );
  }

  return allCases.filter(({ name }) => requestedCases.has(name));
}

function selectViewports() {
  if (requestedViewports.size === 0) return UI_VIEWPORTS;

  const known = new Set(UI_VIEWPORTS.map(({ name }) => name));
  const unknown = [...requestedViewports].filter((name) => !known.has(name));
  if (unknown.length) {
    throw new Error(
      `Unknown UI_VIEWPORTS: ${unknown.join(', ')}. Choose from: ${[...known].join(', ')}`
    );
  }

  return UI_VIEWPORTS.filter(({ name }) => requestedViewports.has(name));
}

function boxesOverlap(a, b) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

/**
 * PID-364: Marcel (North) is on turn. Your tap on a card answers without words:
 * the card shakes and settles, and his shine lights (a still capture holds it lit).
 * Out for the hand, a tap on your folded cards does nothing at all.
 */
async function assertBlockedTap(page, testCase) {
  const out = testCase.flaky === 'out-tap';
  await page.getByTestId(`rendered-hand-card-count-${out ? 0 : 2}`).waitFor({ state: 'attached' });
  await page.waitForTimeout(1_500);
  const shine = () =>
    page
      .getByTestId('seat-north')
      .getByTestId('turn-light')
      .evaluate((light) => Number(getComputedStyle(light).opacity));
  assert.equal(await shine(), 0.55, `${testCase.name}: North's shine starts quiet`);
  const hand = (await page.evaluate(() => window.__pidroCardMotion()))
    .filter((sprite) => sprite.kind === 'hand')
    .sort((a, b) => a.x - b.x);
  const spot = out
    ? await getStableBox(page.getByTestId('seat-south-folded'), page)
    : { x: hand[0].x - (hand[0].width * hand[0].scale) / 2 + 4, y: hand[0].y - 4 };
  const key = hand[0]?.key;
  await page.evaluate((key) => {
    const xs = [];
    const started = performance.now();
    const sample = () => {
      const sprite = window.__pidroCardMotion().find((s) => s.key === key);
      if (sprite) xs.push(sprite.x);
      if (performance.now() - started < 700) requestAnimationFrame(sample);
      else window.__pidroShake = xs;
    };
    requestAnimationFrame(sample);
  }, key);
  await page.mouse.click(
    out ? spot.x + spot.width / 2 : spot.x,
    out ? spot.y + spot.height / 2 : spot.y
  );
  await page.waitForFunction(() => window.__pidroShake);
  const xs = await page.evaluate(() => window.__pidroShake);
  assert.equal(await page.getByTestId('table-feedback').count(), 0, `${testCase.name}: no words`);
  if (out) {
    assert.equal(xs.length, 0, `${testCase.name}: no card of yours to shake`);
    assert.equal(await shine(), 0.55, `${testCase.name}: North's shine stays quiet`);
    return;
  }
  const swing = Math.max(...xs.map((x) => Math.abs(x - xs[0])));
  if (testCase.reducedMotion) assert.equal(swing, 0, `${testCase.name}: the card holds still`);
  else assert.ok(swing >= 2, `${testCase.name}: the card shook only ${swing.toFixed(1)}px`);
  assert.ok(Math.abs(xs.at(-1) - xs[0]) < 0.5, `${testCase.name}: the card settled back`);
  assert.equal(await shine(), 1, `${testCase.name}: North's shine lit`);
  console.log(`${testCase.name}: shook ${swing.toFixed(1)}px and settled; North lit; no words`);
}

/** PID-364: Eli's seat line through the sweep, every frame until the result (or 1.5 s held). */
async function assertSweep(page, testCase) {
  if (!testCase.sweep) return;
  const rest = testCase.locale === 'sv' ? 'Tar resten' : 'Takes the rest';
  await page.getByTestId('seat-east').getByText(rest, { exact: true }).waitFor({ timeout: 20_000 });
  let lines;
  if (testCase.sweep === 'on') {
    await page.waitForFunction(() => window.__pidroSweep.result, null, { timeout: 20_000 });
    lines = await page.evaluate(() => window.__pidroSweep);
    assert.ok(lines.cards.length >= 4, `${testCase.name}: the sweep played ${lines.cards}`);
  } else {
    lines = { seen: [], cards: [] };
    for (let at = 0; at < 1_500; at += 100) {
      lines.seen.push(await page.getByTestId('seat-east').innerText());
      await page.waitForTimeout(100);
    }
  }
  for (const line of lines.seen)
    assert.ok(line.includes(rest), `${testCase.name}: Eli's line read ${JSON.stringify(line)}`);
  console.log(
    `${testCase.name}: ${JSON.stringify([...new Set(lines.seen)])} through ${lines.cards.join(', ')}`
  );
}

async function assertTargetGeometry(page, testCase, viewport) {
  const target = testCase.testId ? page.getByTestId(testCase.testId).first() : null;
  if (target) {
    await target.waitFor({ state: 'visible', timeout: 20_000 });
    const box = await getStableBox(target, page);
    if (!box) throw new Error(`${testCase.name} target has no geometry`);
    assertInsideViewport(`${testCase.name} target`, box, viewport);

    await assertNorthClear(page, testCase, viewport, testCase.protectNorthSeat ? box : null);

    if (testCase.testId === 'trump-picker') {
      await assertTrumpPicker(page, testCase, box, viewport);
    }
    if (testCase.protectPlayerHand) {
      await assertAbovePlayerHand(page, testCase.name, box, viewport, biddingClearance(viewport));
      await assertBidGridLayout(page, viewport, testCase.locale);
    }

    if (testCase.name === 'table-playing') {
      await assertSeatPlacement(page, viewport);
    }
    if (testCase.name === 'table-hand-sweep-spectator') {
      await page.getByTestId('rendered-hand-card-count-0').waitFor({ state: 'attached' });
      assert.equal(await page.getByTestId('seat-south-cards').locator('img').count(), 6);
    }
    if (testCase.flaky) {
      const sv = testCase.locale === 'sv';
      const words = {
        offline: sv ? 'Återansluter…' : 'Reconnecting…',
        'auto-card': sv
          ? 'Tiden tog slut – vi spelade 5♣ åt dig'
          : 'Time ran out — we played 5♣ for you',
        'late-card': sv
          ? 'Tiden tog slut – vi spelade 5♣ åt dig'
          : 'Time ran out — we played 5♣ for you',
        'auto-pass': sv ? 'Tiden tog slut – vi passade åt dig' : 'Time ran out — we passed for you',
        'auto-bid': sv ? 'Tiden tog slut – vi bjöd 7 åt dig' : 'Time ran out — we bid 7 for you',
        'late-tap': sv ? 'För sent – sticket gick vidare.' : 'Too late, the trick moved on.',
        'away-one': sv
          ? 'Medan du var borta spelades 10♠ åt dig.'
          : 'While you were away, 10♠ was played for you.',
        'away-out': sv
          ? 'Medan du var borta spelades 10♠ och 5♥ åt dig, du är ute den här given.'
          : "While you were away, 10♠ and 5♥ were played for you, you're out this hand.",
      };
      if (words[testCase.flaky]) assert.equal(await target.innerText(), words[testCase.flaky]);
      if (testCase.flaky === 'away-out') await page.getByTestId('seat-south-folded').waitFor();
      if (testCase.flaky === 'early-tap' || testCase.flaky === 'out-tap')
        await assertBlockedTap(page, testCase);
      if (testCase.flaky === 'spectator') {
        const badge = await page.getByTestId('watching-badge').boundingBox();
        assertInsideViewport('watching badge', badge, viewport);
        for (const seat of ['north', 'east', 'south', 'west']) {
          const backs = page.getByTestId(`seat-${seat}-cards`);
          assert.equal(
            await backs.locator('img').count(),
            seat === 'south' ? 7 : 6,
            `${seat} has every card back`
          );
          // Side stacks intentionally bleed at the bare edge; their wrapper spans the screen.
          if (seat === 'south' || seat === 'north')
            assertInsideViewport(`${seat} backs`, await backs.boundingBox(), viewport);
          for (const image of await backs.locator('img').all()) {
            const box = await image.boundingBox();
            assert.ok(
              box &&
                box.x < viewport.width &&
                box.x + box.width > 0 &&
                box.y >= 0 &&
                box.y + box.height <= viewport.height,
              `${seat} back remains visible`
            );
            assert.ok(!boxesOverlap(box, badge), `${seat} backs clear the watching badge`);
          }
        }
      }
    }
    if (testCase.longNames) {
      await assertNamesFit(page, viewport, testCase.northNameMin);
    }

    if (testCase.sideInsets) {
      await assertSideStacksInsideCutouts(page, testCase, viewport);
    }
  } else if (testCase.text) {
    await page.getByText(testCase.text, { exact: true }).first().waitFor({ timeout: 15_000 });
  }

  if (['table-waiting', 'table-waiting-host'].includes(testCase.name)) {
    await page.getByTestId('new-table-seat-north').waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: /^(Manage |Move to |Lock joins|Unlock joins)/ })
        .count(),
      0
    );
  }

  await assertMinimumTouchTargets(page, testCase.name, viewport, { checkInputs: true });
  await assertWoodButtonsHoldLabels(page, testCase.name, viewport);
}

// Game over never scrolls: every block sits inside the viewport, none
// overlaps another, and the rematch row says who is in.
async function assertGameOver(page, testCase, viewport) {
  const spec = testCase.gameOver;
  if (!spec) return;
  const overlay = page.getByTestId('game-over-overlay');
  await page.getByTestId('victory-confetti').waitFor({ state: 'detached', timeout: 7000 });
  if (spec.headline) {
    await overlay.getByRole('heading', { name: spec.headline, exact: true }).waitFor();
  }
  const small = viewport.name === 'small-portrait' && spec.smallPhone;
  if (spec.eyebrow && !small?.noText) {
    await overlay.getByText(spec.eyebrow, { exact: true }).waitFor();
  }
  if (small?.noText) {
    assert.equal(await overlay.getByText(small.noText, { exact: true }).count(), 0);
  }
  if (spec.seats) {
    // Once you have said yes, you join the row: four avatars, not three.
    assert.equal(
      await page.getByTestId('rematch-seat').count(),
      spec.seats,
      `${testCase.name}: seats`
    );
  }
  if (spec.plaque && small?.noText !== spec.plaque) {
    await overlay.getByText(spec.plaque, { exact: true }).waitFor();
  }
  for (const id of spec.parts ?? []) {
    if (!small?.absent?.includes(id)) await page.getByTestId(id).waitFor();
  }
  // Game over never shows the rule set (PID-292).
  for (const id of ['game-over-rule-set', ...(spec.absent ?? []), ...(small?.absent ?? [])]) {
    assert.equal(await page.getByTestId(id).count(), 0, `${testCase.name}: ${id} should be absent`);
  }
  if (spec.detail !== undefined) {
    const status = (await page.getByTestId('rematch-status').innerText()).split('\n');
    assert.deepEqual(
      status,
      [spec.title, spec.detail].filter(Boolean),
      `${testCase.name}: rematch row in ${viewport.name}`
    );
  }
  if (spec.waiting) {
    assert.equal(await page.getByTestId('play-again').getAttribute('aria-label'), 'Waiting…');
  }
  // The top-level blocks, top to bottom. The link sits inside the chart when
  // there is one, so it only counts on its own.
  const inChart = (await page.getByTestId('how-it-went').count()) > 0;
  const blocks = [];
  for (const id of [
    'game-over-trick',
    'game-over-headline',
    'game-over-score',
    'game-over-league',
    'best-hand',
    'how-it-went',
    ...(inChart ? [] : ['every-hand']),
    'streak-chip',
    'xp-chip',
    'guest-save',
    'rematch-status',
    'play-again',
    'game-over-home',
  ]) {
    const box = (await page.getByTestId(id).count())
      ? await getStableBox(page.getByTestId(id), page)
      : null;
    if (!box) continue;
    assertInsideViewport(`${testCase.name} ${id}`, box, viewport);
    blocks.push([id, box]);
  }
  for (const [i, [a, boxA]] of blocks.entries()) {
    for (const [b, boxB] of blocks.slice(i + 1)) {
      const overlap =
        boxA.x < boxB.x + boxB.width - 1 &&
        boxB.x < boxA.x + boxA.width - 1 &&
        boxA.y < boxB.y + boxB.height - 1 &&
        boxB.y < boxA.y + boxA.height - 1;
      assert.ok(!overlap, `${testCase.name}: ${a} overlaps ${b} in ${viewport.name}`);
    }
  }
  const texts = await overlay.locator('[dir="auto"]').evaluateAll((nodes) =>
    nodes
      .filter((node) => node.getClientRects().length)
      .map((node) => {
        const box = node.getBoundingClientRect();
        return { text: node.textContent, x: box.x, y: box.y, r: box.right, b: box.bottom };
      })
  );
  for (const text of texts) {
    assertInsideViewport(
      `${testCase.name} "${text.text}"`,
      { x: text.x, y: text.y, width: text.r - text.x, height: text.b - text.y },
      viewport
    );
  }
}

// PID-297: photo fixtures hold their state; these checks never invoke a real picker/upload.
async function assertPhotoSheet(page, testCase, viewport) {
  if (!testCase.photo) return;
  const { name, photo } = testCase;
  const guest = testCase.authFixture === guestAuthFixture;
  const sv = testCase.locale === 'sv';
  const camera = page.getByTestId('profile-camera-badge');
  if (guest) assert.equal(await camera.count(), 0, `${name}: guests have no camera badge`);
  if (photo === 'profile') {
    if (guest) return;
    const avatar = await getStableBox(page.getByTestId('profile-avatar-button'), page);
    const badge = await getStableBox(camera, page);
    assert.ok(avatar.width >= 44 && avatar.height >= 44, `${name}: avatar is a 44pt target`);
    assertInsideViewport(`${name} avatar`, avatar, viewport);
    assert.ok(
      badge.x >= avatar.x - 1 &&
        badge.y >= avatar.y - 1 &&
        badge.x + badge.width <= avatar.x + avatar.width + 1 &&
        badge.y + badge.height <= avatar.y + avatar.height + 1,
      `${name}: camera stays within avatar`
    );
    assert.ok(
      badge.x + badge.width / 2 < avatar.x + avatar.width / 2 &&
        badge.y + badge.height / 2 > avatar.y + avatar.height / 2,
      `${name}: camera occupies the bottom-left quadrant`
    );
    const ornaments = page
      .getByTestId('profile-avatar-button')
      .locator('[data-testid*="pin"], [data-testid*="level"]');
    assert.equal(await ornaments.count(), 2, `${name}: Classic pin and level are measured`);
    for (const ornament of await ornaments.all()) {
      const box = await visibleBox(page, ornament);
      if (box) assert.ok(!boxesOverlap(badge, box), `${name}: camera overlaps pin/level`);
    }
    const chip = page.getByTestId('profile-classic-chip');
    await chip.getByText(sv ? 'Gamla Pidro' : 'Old Pidro', { exact: true }).waitFor();
    // The profile intentionally scrolls; only this pill must contain its copy.
    await chip.scrollIntoViewIfNeeded();
    await assertAccountSurfaceFits(chip, name, viewport);
    return;
  }

  const sheet = page.getByTestId('badge-sheet');
  if (!guest) {
    await sheet.getByRole('radio', { name: sv ? /^Gamla Pidro\./ : /^Old Pidro\./ }).waitFor();
    await assertAccountSurfaceFits(sheet, name, viewport);
  }
  await sheet
    .getByText(
      guest
        ? sv
          ? 'Dina märken'
          : 'Your badges'
        : sv
          ? 'Din bild och ring'
          : 'Your photo and ring',
      {
        exact: true,
      }
    )
    .waitFor();
  await sheet.getByTestId('badge-options').waitFor();
  await sheet.getByTestId('badge-done').waitFor();
  // PID-395: Your picture, one row of round radios; the chosen one wears gold.
  const confirming = photo === 'remove';
  const hasPhoto = ['present', 'uploading', 'saved', 'error', 'remove'].includes(photo);
  if (guest) {
    for (const id of [
      'picture-photo',
      'photo-change',
      'photo-remove',
      'photo-retry',
      'photo-confirm',
      'photo-cancel',
      'photo-progress',
    ])
      assert.equal(await sheet.getByTestId(id).count(), 0, `${name}: no ${id} for guests`);
  } else {
    await sheet.getByTestId('photo-preview').waitFor();
  }
  await sheet.getByTestId('photo-actions').waitFor();
  assert.equal(await sheet.getByTestId('photo-change').count(), 0, `${name}: no photo button`);
  if (confirming) {
    assert.equal(
      await sheet.getByTestId('picture-choices').count(),
      0,
      `${name}: confirm replaces`
    );
    await sheet
      .getByTestId('photo-confirm')
      .getByText(sv ? 'Ta bort bilden' : 'Remove photo', { exact: true })
      .waitFor();
    await sheet.getByTestId('photo-cancel').waitFor();
  } else {
    const row = sheet.getByTestId('picture-choices');
    await row.waitFor();
    assert.equal(await row.getAttribute('role'), 'radiogroup', `${name}: picture radiogroup`);
    // The row's words yield to a line under the avatar: an error takes all of them.
    const errored = ['error', 'face-error'].includes(photo);
    const quiet = errored || ['uploading', 'saved', 'face-saved'].includes(photo);
    assert.equal(
      await sheet.getByText(sv ? 'Din bild' : 'Your picture', { exact: true }).count(),
      errored ? 0 : 1,
      `${name}: Your picture eyebrow`
    );
    assert.equal(
      await sheet
        .getByText(
          sv
            ? 'Ett tryck så är den din. Byt när du vill.'
            : 'One tap and it is yours. Change it any time.',
          { exact: true }
        )
        .count(),
      quiet ? 0 : 1,
      `${name}: help line`
    );
    const captions = guest
      ? sv
        ? ['Ansikte 1', 'Ansikte 2']
        : ['Face 1', 'Face 2']
      : sv
        ? ['Ansikte 1', 'Ansikte 2', 'Foto']
        : ['Face 1', 'Face 2', 'Photo'];
    const chosen = hasPhoto ? 2 : ['face', 'face-saved'].includes(photo) ? 1 : 0;
    const disc = viewport.height < 700 ? 64 : 84;
    const radios = await row.evaluate((root) =>
      [...root.querySelectorAll('[role="radio"]')].map((radio) => {
        const face = radio.firstElementChild.firstElementChild;
        const caption = radio.querySelector('[dir="auto"]');
        const box = face.getBoundingClientRect();
        return {
          label: radio.getAttribute('aria-label'),
          checked: radio.getAttribute('aria-checked'),
          caption: caption.textContent,
          gold: getComputedStyle(caption).color === 'rgb(255, 212, 71)',
          ring: getComputedStyle(face).borderTopColor,
          dashed: getComputedStyle(face).borderTopStyle === 'dashed',
          image: face.querySelector('img')?.getAttribute('src') ?? null,
          check: radio.firstElementChild.children.length > 1,
          top: box.top,
          width: box.width,
          height: box.height,
        };
      })
    );
    assert.deepEqual(
      radios.map(({ label, caption }) => [label, caption]),
      captions.map((caption) => [caption, caption]),
      `${name}: Face 1, Face 2${guest ? '' : ', Photo'}`
    );
    for (const [index, radio] of radios.entries()) {
      const on = index === chosen;
      assert.equal(radio.checked, String(on), `${name}: ${radio.label} checked`);
      assert.equal(radio.gold, on, `${name}: ${radio.label} caption gold only when chosen`);
      assert.equal(radio.check, on, `${name}: ${radio.label} check badge only when chosen`);
      assert.equal(
        radio.ring === 'rgb(226, 175, 69)',
        on,
        `${name}: ${radio.label} gold ring only when chosen`
      );
      assert.ok(
        Math.abs(radio.width - disc) <= 1 && Math.abs(radio.height - disc) <= 1,
        `${name}: ${radio.label} is a ${disc}px disc, got ${radio.width}×${radio.height}`
      );
      assert.ok(Math.abs(radio.top - radios[0].top) <= 1, `${name}: the row stays one line`);
    }
    assert.match(radios[0].image ?? '', /avatar1/, `${name}: Face 1 is avatar1.png`);
    assert.match(radios[1].image ?? '', /avatar2/, `${name}: Face 2 is avatar2.png`);
    if (!guest) {
      assert.equal(radios[2].dashed, !hasPhoto, `${name}: an empty Photo is a dashed circle`);
      if (hasPhoto) assert.match(radios[2].image ?? '', /marcel/, `${name}: Photo shows it`);
      else assert.equal(radios[2].image, null, `${name}: an empty Photo shows the camera`);
    }
    // The big avatar wears the chosen picture.
    if (!guest)
      assert.match(
        (await sheet.getByTestId('photo-preview').locator('img').first().getAttribute('src')) ?? '',
        [/avatar1/, /avatar2/, /marcel/][chosen],
        `${name}: the big avatar shows the chosen picture`
      );
    const removable = ['present', 'saved'].includes(photo);
    assert.equal(
      await sheet.getByTestId('photo-remove').count(),
      removable ? 1 : 0,
      `${name}: Remove photo while a photo is on and nothing else is happening`
    );
    if (removable)
      await sheet
        .getByTestId('photo-remove')
        .getByText(sv ? 'Ta bort bilden' : 'Remove photo', { exact: true })
        .waitFor();
  }
  if (photo === 'saved') {
    await sheet
      .getByTestId('photo-feedback')
      .getByText(sv ? 'Bilden är sparad' : 'Photo saved', { exact: true })
      .waitFor();
  }
  if (photo === 'face-saved') {
    const saved = sheet
      .getByTestId('photo-feedback')
      .getByText(
        sv ? 'Sparat. Alla vid bordet ser det nu.' : 'Saved. Everyone at the table sees it now.',
        { exact: true }
      );
    await saved.waitFor();
    assert.equal(
      await saved.evaluate((el) => getComputedStyle(el).color),
      'rgb(139, 234, 255)',
      `${name}: the saved line is quiet cyan`
    );
  }
  if (photo === 'error' || photo === 'face-error') {
    await sheet.getByTestId('photo-feedback').waitFor();
    if (photo === 'face-error')
      await sheet
        .getByTestId('photo-feedback')
        .getByText(
          sv ? 'Kunde inte byta bilden. Försök igen.' : 'Could not change your picture. Try again.',
          { exact: true }
        )
        .waitFor();
    else
      assert.ok(
        (await sheet.getByTestId('photo-feedback').innerText()).trim(),
        `${name}: error copy`
      );
    await sheet
      .getByTestId('photo-retry')
      .getByText(sv ? 'Försök igen' : 'Try again', { exact: true })
      .waitFor();
  }
  if (photo === 'uploading') {
    const progress = sheet.getByTestId('photo-progress');
    await progress.waitFor();
    assert.equal(await progress.getAttribute('role'), 'progressbar');
    assert.ok(await progress.getAttribute('aria-label'), `${name}: progress is labelled`);
    for (const radio of await sheet.getByTestId('picture-choices').getByRole('radio').all())
      assert.equal(await radio.getAttribute('aria-disabled'), 'true', `${name}: row waits`);
  }
  const wood = await sheet.evaluate((root) =>
    [...root.querySelectorAll('[role="button"], [role="link"]')]
      .filter(
        (el) =>
          el.getAttribute('data-material') === 'wood' ||
          (el.firstElementChild &&
            getComputedStyle(el.firstElementChild).backgroundColor === 'rgb(42, 21, 5)')
      )
      .map((el) => el.getAttribute('data-testid'))
  );
  assert.deepEqual(
    wood,
    confirming ? ['photo-confirm'] : [],
    `${name}: wood only to confirm removal`
  );
  for (const id of ['photo-remove', 'photo-retry', 'photo-cancel', 'badge-done']) {
    const link = sheet.getByTestId(id);
    if (!(await link.count())) continue;
    assert.equal(await link.getAttribute('role'), 'link', `${name}: ${id} is a link`);
    if (id === 'photo-remove' || id === 'photo-retry') {
      const cyan = await link.evaluate((el) =>
        [el, ...el.querySelectorAll('[dir="auto"]')].some(
          (text) => getComputedStyle(text).color === 'rgb(139, 234, 255)'
        )
      );
      assert.ok(cyan, `${name}: ${id} uses cyan link copy`);
    }
  }

  // Disabled controls still need a full touch-sized slot; radio rows too.
  for (const control of await sheet
    .locator('[role="button"], [role="link"], [role="radio"]')
    .all()) {
    const box = await visibleBox(page, control);
    if (!box) continue;
    assert.ok(
      box.width >= 44 && box.height >= 44,
      `${name}: 44pt target ${await control.innerText()}`
    );
  }
  const layout = await sheet.evaluate((root) => {
    const sectionSelector = [
      '[data-testid="photo-preview"]',
      '[data-testid="photo-feedback"]',
      '[data-testid="photo-actions"]',
      '[data-testid="badge-options"]',
      '[data-testid="badge-done"]',
      '[role="heading"]',
    ].join(', ');
    const box = (el) => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return {
        x,
        y,
        width,
        height,
        label: el.getAttribute('data-testid') ?? el.textContent.trim(),
      };
    };
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width && rect.height && getComputedStyle(el).visibility !== 'hidden';
    };
    return {
      overflow: [root, ...root.querySelectorAll('*')]
        .filter(visible)
        .filter((el) => {
          const style = getComputedStyle(el);
          return (
            (['auto', 'scroll'].includes(style.overflowY) &&
              el.scrollHeight > el.clientHeight + 2) ||
            (['auto', 'scroll'].includes(style.overflowX) && el.scrollWidth > el.clientWidth + 2) ||
            (el.matches('[dir="auto"]') &&
              (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2))
          );
        })
        .map((el) => el.getAttribute('data-testid') ?? el.textContent.trim()),
      sections: [...root.querySelectorAll(sectionSelector)]
        .filter(visible)
        .filter((el) => !el.parentElement.closest(sectionSelector))
        .map(box),
      content: [
        ...root.querySelectorAll(
          `${sectionSelector}, [dir="auto"], [role="button"], [role="link"], [role="radio"], [role="progressbar"]`
        ),
      ]
        .filter(visible)
        .map(box),
    };
  });
  assert.deepEqual(layout.overflow, [], `${name}: no clipping or scrolling in ${viewport.name}`);
  const bounds = await getStableBox(sheet, page);
  for (const box of layout.content) {
    assertInsideViewport(`${name} ${box.label}`, box, viewport);
    assert.ok(
      box.x >= bounds.x - 1 &&
        box.y >= bounds.y - 1 &&
        box.x + box.width <= bounds.x + bounds.width + 1 &&
        box.y + box.height <= bounds.y + bounds.height + 1,
      `${name}: ${box.label} stays inside sheet`
    );
  }
  for (const [index, a] of layout.sections.entries()) {
    for (const b of layout.sections.slice(index + 1))
      assert.ok(!boxesOverlap(a, b), `${name}: ${a.label} overlaps ${b.label}`);
  }
}

// First launch fits without scrolling or overlaps, with 44pt targets.
// Marcel's note keeps exactly one wood button: Let's play.
async function assertFirstLaunchScreens(page, testCase, viewport) {
  if (!testCase.welcome && !testCase.name.startsWith('age')) return;
  const sv = testCase.locale === 'sv';
  const sheet = page.getByTestId(testCase.testId);
  const felt = page.getByTestId('felt-background').first();
  assert.deepEqual(
    await felt.locator('img').first().boundingBox(),
    await felt.boundingBox(),
    'felt image fills its opaque root'
  );
  const language = sheet.getByTestId('language-switch');
  assert.equal(await language.getByRole('radio').count(), 2);
  assert.equal(
    await language
      .getByRole('radio', { name: sv ? 'Svenska' : 'English' })
      .getAttribute('aria-checked'),
    'true'
  );
  if (testCase.welcome) {
    await sheet
      .getByText(sv ? 'Välkommen till nya Pidro' : 'Welcome to the new Pidro', { exact: true })
      .waitFor();
    await sheet
      .getByText(
        sv
          ? 'Din gamla Pidro-app fungerar som vanligt. Där ändras ingenting.'
          : 'Your old Pidro app keeps working. Nothing there changes.',
        { exact: true }
      )
      .waitFor();
    await assertAccountSurfaceFits(sheet, testCase.name, viewport);
    await sheet.getByText('marcel@pidro.online', { exact: true }).waitFor();
    const photo = sheet.getByTestId('welcome-photo');
    await photo.locator('img').evaluate((image) => image.decode());
    assert.equal(await photo.locator('img').evaluate((image) => image.naturalWidth), 288);
    assert.deepEqual(
      await photo.boundingBox(),
      await photo.locator('..').boundingBox(),
      'portrait fits inside its ring'
    );
    assert.equal(await sheet.getByText('M', { exact: true }).count(), 0);
  }
  const overflow = await sheet.evaluate((root) =>
    [root, ...root.querySelectorAll('*')]
      .filter(
        (el) =>
          ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) &&
          el.scrollHeight > el.clientHeight + 2
      )
      .map((el) => el.scrollHeight - el.clientHeight)
  );
  assert.deepEqual(overflow, [], `${testCase.name}: no scrolling in ${viewport.name}`);
  await assertMinimumTouchTargets(page, testCase.name, viewport);
  if (testCase.welcome) {
    const wood = await sheet.evaluate((root) =>
      [...root.querySelectorAll('[role="button"]')]
        .filter(
          (button) =>
            button.firstElementChild &&
            getComputedStyle(button.firstElementChild).backgroundColor === 'rgb(42, 21, 5)'
        )
        .map((button) => button.getAttribute('aria-label') ?? button.textContent.trim())
    );
    assert.deepEqual(
      wood,
      [sv ? 'Nu spelar vi' : "Let's play"],
      `${testCase.name}: one wood button`
    );
  }
  // Every line of text and every control sits on screen in its own box.
  const boxes = await sheet.evaluate((root) =>
    [
      ...root.querySelectorAll(
        '[dir="auto"], [role="button"], [role="link"], [role="radio"], [data-testid="welcome-photo"]'
      ),
    ]
      .filter(
        (el) =>
          !el.parentElement.closest('[dir="auto"], [role="button"], [role="radio"], [role="link"]')
      )
      .filter((el) => !el.querySelector('[role="button"]'))
      .map((el) => {
        const { x, y, width, height } = el.getBoundingClientRect();
        return { text: el.textContent.trim(), role: el.getAttribute('role'), x, y, width, height };
      })
      .filter((box) => box.width && box.height)
  );
  for (const box of boxes) assertInsideViewport(`${testCase.name} "${box.text}"`, box, viewport);
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      const overlap =
        a.x < b.x + b.width - 1 &&
        b.x < a.x + a.width - 1 &&
        a.y < b.y + b.height - 1 &&
        b.y < a.y + a.height - 1;
      assert.ok(!overlap, `${testCase.name}: "${a.text}" overlaps "${b.text}" in ${viewport.name}`);
    }
  }
}

// PID-316: Tell us is the first row of the Settings panel, and opens the sheet.
async function assertFeedbackRow(page, testCase, viewport) {
  if (!testCase.feedback) return;
  const sv = testCase.locale === 'sv';
  const row = page.getByTestId('settings-tell');
  if (testCase.feedback === 'none') {
    // PID-348: a guest has Settings without Tell us; Language comes first.
    await page.getByTestId('settings-language').waitFor();
    assert.equal(await row.count(), 0, `${testCase.name}: no Tell us for a guest`);
    return;
  }
  await row.getByText(sv ? 'Berätta för oss' : 'Tell us', { exact: true }).waitFor();
  await row
    .getByText(
      sv ? 'Något som känns fel, eller något du gillar?' : 'Something off, or something you love?',
      { exact: true }
    )
    .waitFor();
  const box = await row.boundingBox();
  assert.ok(box.height >= 44, `${testCase.name}: the row is a 44pt target`);
  assertInsideViewport(`${testCase.name} row`, box, viewport);
  const language = await page.getByTestId('settings-language').boundingBox();
  assert.ok(box.y + box.height <= language.y, `${testCase.name}: Tell us comes first`);
}

// A wood button's keyline stays inside its rim and its label inside the face's
// padding, so nothing is cut where the platform clips (PID-212). Android sizes
// text to the room the face has left and clips the glyphs to that box, so a
// label that only spills into the padding is cut on a phone (PID-299).
async function assertWoodButtonsHoldLabels(page, name, viewport) {
  const spills = await page.evaluate(() => {
    const keylineColor = 'rgb(42, 21, 5)';
    const found = [];
    for (const rim of document.querySelectorAll('[role="button"], [role="radio"]')) {
      const keyline = rim.firstElementChild;
      if (!keyline || getComputedStyle(keyline).backgroundColor !== keylineColor) continue;
      const rimBox = rim.getBoundingClientRect();
      if (!rimBox.height) continue;
      const pad = parseFloat(getComputedStyle(rim).paddingBottom);
      const keyBox = keyline.getBoundingClientRect();
      const faceStyle = getComputedStyle(keyline.firstElementChild);
      const face = keyline.firstElementChild.getBoundingClientRect();
      const top = face.top + parseFloat(faceStyle.paddingTop);
      const bottom = face.bottom - parseFloat(faceStyle.paddingBottom);
      const label = rim.getAttribute('aria-label');
      if (keyBox.bottom > rimBox.bottom - pad + 0.5) found.push(`${label}: keyline below rim`);
      for (const text of keyline.querySelectorAll('div[dir="auto"]')) {
        const box = text.getBoundingClientRect();
        // The label's 1px optical lift is drawn, not laid out.
        const lift = new DOMMatrixReadOnly(getComputedStyle(text).transform).m42;
        if (box.top - lift < top - 0.5 || box.bottom - lift > bottom + 0.5) {
          found.push(`${label}: label outside face`);
        }
      }
    }
    return found;
  });
  assert.deepEqual(spills, [], `${name} wood buttons in ${viewport.name}`);
}

async function visibleBox(page, locator) {
  const first = locator.first();
  if (!(await first.count()) || !(await first.isVisible())) return null;
  return getStableBox(first, page);
}

// The header (score plaque and menu, or the waiting toolbar) and a protected
// window must never cover the north seat or its cards, nor the window the header.
async function assertNorthClear(page, testCase, viewport, windowBox) {
  const waiting = (await page.getByTestId('new-table-seat-north').count()) > 0;
  const north = waiting
    ? { 'north seat': page.getByTestId('new-table-seat-north') }
    : {
        'north seat': page.getByTestId('seat-north'),
        'north cards': page.getByTestId('seat-north-cards').locator(':scope > div'),
      };
  if (!waiting && windowBox)
    await north['north seat'].first().waitFor({ state: 'visible', timeout: 20_000 });
  const header = waiting
    ? { rules: page.getByTestId('waiting-rule-set') }
    : {
        'score plaque': page.getByRole('button', { name: /Every hand\.|Alla givar\./ }),
        menu: page.getByRole('button', { name: /^(Table settings|Bordsinställningar)$/ }),
      };
  const covers = { ...header, ...(windowBox ? { window: windowBox } : {}) };
  for (const [coverName, cover] of Object.entries(covers)) {
    const coverBox = cover === windowBox ? windowBox : await visibleBox(page, cover);
    if (!coverBox) continue;
    const targets = cover === windowBox ? { ...north, ...header } : north;
    for (const [targetName, target] of Object.entries(targets)) {
      const targetBox = await visibleBox(page, target);
      if (targetBox && boxesOverlap(coverBox, targetBox)) {
        throw new Error(
          `${testCase.name}: ${coverName} overlaps the ${targetName} in ${viewport.name}: ${coverName}=${JSON.stringify(coverBox)} ${targetName}=${JSON.stringify(targetBox)}`
        );
      }
    }
  }
}

// PID-216: a table message shows whole, never cut off, so a slow reader can
// finish it; the ones that time out also close on a tap.
const TABLE_MESSAGES = {
  'table-notice': {
    testId: 'table-feedback',
    text: 'Nora lost connection. A bot is playing for now.',
    tapCloses: true,
  },
  'table-hand-made': { testId: 'hand-result', text: 'We made it', tapCloses: true },
  'table-hand-set': { testId: 'hand-result', text: 'We missed by 3', tapCloses: true },
  'table-hand-they-set': {
    testId: 'hand-result',
    text: 'Nora took their Pidro',
    tapCloses: true,
  },
};

// Each Classic step has one job, with the same default forward button.
async function assertClassicLogin(page, testCase, viewport) {
  if (testCase.path === '/welcome') {
    const sv = testCase.locale === 'sv';
    const plaque = page.getByRole('button', {
      name: sv
        ? 'Spelar du redan Pidro? Ta med ditt namn och dina spel.'
        : 'Already play Pidro? Bring your name and games.',
      exact: true,
    });
    await plaque.waitFor();
    const fullScreenFit =
      !testCase.pendingInvite &&
      ['portrait', 'small-portrait', 'landscape', 'tablet-portrait'].includes(viewport.name);
    await assertAccountSurfaceFits(
      fullScreenFit ? page.getByTestId('welcome-screen') : plaque,
      testCase.name,
      viewport
    );
    return;
  }
  if (testCase.path === '/(auth)/forgot-password') {
    const screen = page.getByTestId('forgot-password-screen');
    await screen
      .getByRole('link', {
        name:
          testCase.locale === 'sv'
            ? 'Spelar du i gamla Pidro? Hitta ditt konto'
            : 'Use the old Pidro app? Find your account',
        exact: true,
      })
      .waitFor();
    await assertAccountSurfaceFits(screen, testCase.name, viewport);
    return;
  }
  if (!/claim-classic|classic-forgot|classic-help/.test(testCase.path)) return;
  const sv = testCase.locale === 'sv';
  const screen = page
    .getByTestId(
      testCase.path.includes('claim-classic')
        ? 'claim-classic-screen'
        : testCase.path.includes('classic-help')
          ? 'classic-help-screen'
          : 'classic-forgot-screen'
    )
    .last();
  assert.doesNotMatch(
    await screen.innerText(),
    /\bClassic\b|\bclaim\b/i,
    `${testCase.name}: player-facing words`
  );
  const fixture = new URL(testCase.path, baseUrl).searchParams.get('fixture');
  const expectedCopy = testCase.path.includes('claim-classic')
    ? {
        method: sv ? 'Hur loggar du in i Pidro i dag?' : 'How do you sign in to Pidro today?',
        login: sv ? 'Logga in som i gamla appen' : 'Sign in as you do in the old app',
      }[fixture]
    : testCase.path.includes('classic-help')
      ? fixture === 'sent'
        ? sv
          ? 'Meddelandet har skickats'
          : 'Message sent'
        : sv
          ? 'Vi hittar det åt dig'
          : 'We’ll find it for you'
      : {
          'not-found': sv
            ? 'Vi hittar inget konto med det namnet eller den e-postadressen i gamla Pidro.'
            : 'We can’t find a Pidro account with that name or email in the old app.',
          unavailable: sv
            ? 'Vi kan inte skicka inloggningskoder just nu. Be om hjälp så hittar vi ditt konto.'
            : 'We can’t send sign-in codes right now. Get help and we’ll find your account.',
          'code-invalid': sv
            ? 'Koden fungerade inte. Be om en ny.'
            : "That code didn't work. Ask for a new one.",
        }[fixture];
  if (expectedCopy) await screen.getByText(expectedCopy, { exact: true }).waitFor();
  await assertAccountSurfaceFits(screen, testCase.name, viewport);
  const overflow = await screen.evaluate((root) =>
    [root, ...root.querySelectorAll('*')]
      .filter(
        (el) =>
          ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) &&
          el.scrollHeight > el.clientHeight + 2
      )
      .map((el) => el.scrollHeight - el.clientHeight)
  );
  assert.deepEqual(overflow, [], `${testCase.name}: no scrolling`);
  await assertMinimumTouchTargets(page, testCase.name, viewport, { checkInputs: true });
  const forward = screen.getByTestId('classic-forward');
  assert.ok((await forward.count()) <= 1, `${testCase.name}: at most one wood action`);
  if (await forward.count()) {
    const box = await forward.boundingBox();
    const tablet = Math.min(viewport.width, viewport.height) >= 700;
    const landscape = viewport.width > viewport.height && viewport.height < 500;
    assert.equal(
      box.height,
      tablet ? 64 : landscape ? 54 : 60,
      `${testCase.name}: default CTA height`
    );
    assertInsideViewport(`${testCase.name}: forward`, box, viewport);
    const type = await forward
      .locator('[dir="auto"]')
      .last()
      .evaluate((el) => getComputedStyle(el).fontSize);
    assert.equal(
      type,
      `${tablet ? 27 : landscape ? 24 : 25}px`,
      `${testCase.name}: default CTA type`
    );
    assert.equal(
      await forward.evaluate((el) => el.parentElement.lastElementChild === el),
      true,
      `${testCase.name}: forward is last in its window`
    );
    console.log(
      `  Classic CTA ${testCase.name} ${viewport.width}×${viewport.height}: ${box.height}px / ${type}`
    );
  }
  if (testCase.classicPassword) {
    await screen
      .getByText(sv ? 'Ditt namn förblir ThunderThor88.' : 'Your name stays ThunderThor88.', {
        exact: true,
      })
      .waitFor();
    assert.equal(await screen.locator('input').count(), 1, `${testCase.name}: one input`);
    await screen.getByLabel(sv ? 'Nytt lösenord' : 'New password', { exact: true }).waitFor();
    assert.equal(await screen.getByText('sonja.lindqvist@example.com', { exact: true }).count(), 0);
  }
  if (fixture === 'password-short' || fixture === 'password-reused') {
    await screen
      .getByText(sv ? 'Hittade dig, Petter.' : 'Found you, Petter.', { exact: true })
      .waitFor();
    assert.ok(
      (await screen.innerText()).includes(
        sv ? 'Ditt gamla lösenord stämde.' : 'Your old password was right.'
      )
    );
    const short = fixture === 'password-short';
    assert.equal(await screen.locator('input').count(), short ? 1 : 0);
    if (short) {
      await screen.getByLabel(sv ? 'Nytt lösenord' : 'New password', { exact: true }).waitFor();
      await screen
        .getByText(
          sv
            ? 'Nya Pidro kräver minst 8 tecken, så välj ett nytt lösenord. Ditt konto och dina poäng är kvar.'
            : 'The new Pidro needs at least 8 characters, so choose a new password. Your account and your points stay.',
          { exact: true }
        )
        .waitFor();
    } else {
      assert.ok(
        (await screen.innerText()).includes(
          sv ? 'Fortsätt använda det i nya Pidro.' : 'Keep using it in the new Pidro.'
        )
      );
    }
    assert.doesNotMatch(await screen.innerText(), /oldpass|petter@example.com/);
  }
  if (/fixture=(preview|social)/.test(testCase.path)) {
    assert.equal(await screen.locator('input').count(), 0, 'identity check has no inputs');
  }
  if (testCase.yesInputs !== undefined) {
    await screen.getByTestId('classic-forward').click();
    await screen
      .getByText(testCase.yesInputs ? 'New password' : 'Is this you?', { exact: true })
      .first()
      .waitFor();
    assert.equal(
      await screen.locator('input').count(),
      testCase.yesInputs,
      `${testCase.name}: inputs after Yes, that's me`
    );
  }
  if (testCase.path.includes('fixture=login')) {
    assert.equal(await screen.locator('input').count(), 2, 'Classic sign-in has two inputs');
    assert.equal(await screen.getByRole('button', { name: /Apple|Facebook/ }).count(), 0);
  }
  if (/fixture=(details|taken|rename-details)/.test(testCase.path)) {
    assert.equal(
      await screen.locator('input').count(),
      testCase.path.includes('rename-details') ? 4 : 3,
      'every missing/refused value remains editable'
    );
  }
  if (testCase.path.includes('fixture=login-wrong-twice')) {
    await screen
      .getByRole('link', { name: sv ? 'Mejla mig en kod' : 'Email me a code', exact: true })
      .waitFor();
  }
  if (testCase.path.includes('fixture=code')) {
    await screen
      .getByRole('link', { name: sv ? 'Skicka igen' : 'Send again', exact: true })
      .waitFor();
  }
  await assertAlreadyInPidro(screen, testCase);
}

// PID-293: an owned Classic account leads to signing in, except over a saved account.
const ALREADY_IN_PIDRO = {
  'classic-conflict-fresh': {
    wood: 1,
    lines: ['Sign in with your username and password.'],
    links: ['Forgot password?', 'Back'],
  },
  'classic-conflict-guest': {
    wood: 1,
    lines: ['Sign in with your username and password.', "Your guest games won't come along."],
    links: ['Forgot password?', 'Back'],
  },
  'classic-conflict-guest-apple': {
    wood: 1,
    lines: ['You signed in with Apple.'],
    links: ['Back'],
  },
  'classic-conflict': {
    wood: 0,
    lines: [
      'Sign in with your username and password.',
      "You're signed in as Bengt. Sign out first to use this one.",
    ],
    links: ['Back'],
  },
  'locale-sv-classic-already-claimed': {
    wood: 1,
    lines: ['Logga in med ditt användarnamn och lösenord.'],
    links: ['Glömt lösenordet?', 'Tillbaka'],
  },
};

async function assertAlreadyInPidro(screen, testCase) {
  const expected = ALREADY_IN_PIDRO[testCase.name];
  if (!expected) return;
  const sv = testCase.locale === 'sv';
  await screen.getByText(sv ? 'Redan i Pidro' : 'Already in Pidro', { exact: true }).waitFor();
  assert.equal(await screen.getByText('Is this you?', { exact: true }).count(), 0);
  assert.equal(
    await screen.getByTestId('classic-forward').count(),
    expected.wood,
    `${testCase.name}: wood buttons`
  );
  if (expected.wood) {
    const label = await screen.getByTestId('classic-forward').innerText();
    assert.equal(label.trim(), sv ? 'Logga in' : 'Sign in', `${testCase.name}: wood label`);
  }
  for (const line of expected.lines) await screen.getByText(line, { exact: true }).waitFor();
  // Every line the case doesn't expect is absent, so a line shown to the wrong player fails.
  const others = sv
    ? []
    : [
        'Sign in with your username and password.',
        'You signed in with Apple.',
        "Your guest games won't come along.",
        "You're signed in as Bengt. Sign out first to use this one.",
      ].filter((line) => !expected.lines.includes(line));
  for (const line of others) {
    assert.equal(
      await screen.getByText(line, { exact: true }).count(),
      0,
      `${testCase.name}: no "${line}"`
    );
  }
  const links = await screen
    .getByRole('link')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
  assert.deepEqual(links, expected.links, `${testCase.name}: links under the window`);
  // Nothing on the screen overlaps: lines, card, button and links each keep their own box.
  const boxes = await screen.evaluate((root) =>
    [...root.querySelectorAll('[dir="auto"], [role="link"], [data-testid="classic-forward"]')]
      .filter((el) => el.textContent.trim() && !el.querySelector('[dir="auto"]'))
      .map((el) => {
        const { x, y, width, height } = el.getBoundingClientRect();
        return { text: el.textContent.trim(), x, y, width, height };
      })
  );
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      const overlap =
        a.x < b.x + b.width - 1 &&
        b.x < a.x + a.width - 1 &&
        a.y < b.y + b.height - 1 &&
        b.y < a.y + a.height - 1;
      assert.ok(!overlap, `${testCase.name}: "${a.text}" overlaps "${b.text}"`);
    }
  }
}

async function assertTableMessageReadable(page, name, viewport) {
  if (await page.getByTestId('hand-result').count()) {
    const panel = page.getByTestId('hand-result-panel');
    assert.equal(
      await panel.getByRole('button').locator('[style*="linear-gradient"]').count(),
      0,
      'no wood button in result panel'
    );
    const waiting = name.includes('own');
    const sv = name.includes('-sv');
    const link = page.getByTestId('hand-continue');
    assert.equal(await link.count(), waiting ? 1 : 0, 'tap line only at own pace');
    if (waiting) {
      assert.equal(await link.getAttribute('role'), 'button');
      assert.equal(await link.innerText(), sv ? 'Tryck för att fortsätta' : 'Tap to continue');
      assert.equal(await page.getByTestId('hand-result-backdrop').getAttribute('role'), 'button');
    }
    const ours = name.includes('all-14') && !name.includes('theirs');
    assert.equal(await page.getByTestId('victory-rays').count(), ours ? 1 : 0);
    assert.equal(
      await page.getByTestId('victory-confetti').count(),
      0,
      'still capture has no flight'
    );
  }
  if (name === 'table-hand-own-retry') {
    const line = page.getByTestId('hand-continue');
    const attempts = page.getByTestId('continue-attempts');
    const panel = await page.getByTestId('hand-result-panel').boundingBox();
    await line.focus();
    await page.keyboard.press('Enter');
    assert.equal(await attempts.innerText(), '1', 'Enter activates the quiet action');
    await page.mouse.click(10, viewport.height / 2);
    await page.mouse.click(panel.x + 20, panel.y + 30);
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="hand-continue"]')?.getAttribute('aria-disabled') !==
        'true'
    );
    assert.equal(
      await attempts.innerText(),
      '1',
      'pending taps issue one request; failure unlocks'
    );
    await line.click();
    // The fixture acknowledges at 350ms and broadcasts 800ms after that.
    await page.waitForTimeout(600);
    assert.ok(await page.getByTestId('hand-result-panel').isVisible(), 'wait for server state');
    assert.ok(await line.isDisabled(), 'acknowledgement does not unlock Continue');
    await page.mouse.click(10, viewport.height / 2);
    await page.mouse.click(panel.x + 20, panel.y + 30);
    assert.equal(await attempts.innerText(), '2', 'success stays locked until the state broadcast');
    await page.getByTestId('hand-result').waitFor({ state: 'detached' });
    assert.equal(await attempts.innerText(), '2');
    return;
  }
  if (
    name === 'table-hand-own' ||
    name === 'table-hand-own-sv' ||
    name.startsWith('table-hand-own-missed-') ||
    (name.startsWith('scores-') && name.endsWith('-own'))
  ) {
    const button = page.getByTestId('hand-continue');
    const box = await button.boundingBox();
    assertInsideViewport(`${name}: Continue`, box, viewport);
    assert.ok(box.height >= 44, `${name}: Continue has a senior-friendly target`);
    if (name.startsWith('scores-')) {
      const panel = await page.getByTestId('hand-result-panel').boundingBox();
      assert.ok(
        panel.y >= 24 && panel.y + panel.height <= viewport.height - 48,
        `${name}: the whole sweep and Continue clear Android's 24/48 insets`
      );
      assert.ok(
        box.y >= 24 && box.y + box.height <= viewport.height - 48,
        `${name}: Continue clears Android's bottom inset`
      );
    }
    assert.equal(await page.getByTestId('hand-result-timer').count(), 0);
    await page.getByTestId('hand-result').click({ position: { x: 10, y: viewport.height / 2 } });
    await page.getByTestId('hand-result').waitFor({ state: 'detached' });
    return;
  }
  const message = TABLE_MESSAGES[name];
  if (!message) return;
  const container = page.getByTestId(message.testId).first();
  const clipped = await container
    .getByText(message.text, { exact: true })
    .evaluate(
      (text) => text.scrollWidth > text.clientWidth + 1 || text.scrollHeight > text.clientHeight + 1
    );
  assert.equal(clipped, false, `${name}: "${message.text}" is cut off in ${viewport.name}`);
  if (!message.tapCloses) return;
  await container.click();
  await container.waitFor({ state: 'detached', timeout: 5_000 });
}

// Nothing the player can tap may sit under the update notice, with every scroll at
// its end. A control is covered where the notice is what a tap there would hit.
async function assertNothingUnderNotice(page, screen, viewport) {
  const covered = await page.evaluate(() => {
    for (const element of document.querySelectorAll('*')) {
      const { overflowY } = getComputedStyle(element);
      if (['auto', 'scroll'].includes(overflowY)) element.scrollTop = element.scrollHeight;
    }
    const notice = document.querySelector(
      '[data-testid="update-notice"], [data-testid="friend-notice"]'
    );
    const tappable = '[role="button"], [role="link"], [role="switch"], input, textarea';
    const noticeBoxes = [notice, ...notice.querySelectorAll(tappable)].map((element) =>
      element.getBoundingClientRect()
    );
    return [...document.querySelectorAll(tappable)]
      .filter((element) => !notice.contains(element))
      .filter((element) => {
        const target = element.getBoundingClientRect();
        return noticeBoxes.some((box) => {
          const left = Math.max(box.left, target.left);
          const right = Math.min(box.right, target.right);
          const top = Math.max(box.top, target.top);
          const bottom = Math.min(box.bottom, target.bottom);
          if (right <= left || bottom <= top) return false;
          const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
          return Boolean(hit && notice.contains(hit));
        });
      })
      .map((element) => element.getAttribute('aria-label') || element.textContent.trim());
  });
  assert.deepEqual(covered, [], `the notice covers controls on ${screen} in ${viewport.name}`);
}

async function assertFriendNotice(page, name, viewport) {
  if (!name.startsWith('friend-notice-')) return;
  const notice = page.getByTestId('friend-notice');
  const count = name.endsWith('queue') ? 2 : /too-late|accepted|linked$/.test(name) ? 0 : 1;
  assert.equal(await notice.count(), 1);
  if (count) {
    assert.equal(await page.getByTestId('friends-invitation-count').innerText(), String(count));
    await page
      .getByRole('button', { name: `Friends, ${count} waiting for your answer`, exact: true })
      .waitFor();
  } else assert.equal(await page.getByTestId('friends-invitation-count').count(), 0);
  await assertNothingUnderNotice(page, 'Home', viewport);
  const pill = await page.getByTestId('tab-pill').boundingBox();
  const card = await notice.boundingBox();
  assert.ok(
    viewport.width > viewport.height
      ? card.x + card.width <= pill.x
      : card.y + card.height <= pill.y
  );
  if (name.endsWith('seat') || name.endsWith('offline'))
    assert.equal(
      await page.getByTestId('seat-invitations').count(),
      0,
      'Home lists the invitation its notice is already asking about'
    );
  if (name.endsWith('offline')) {
    await notice.getByRole('button', { name: 'Not now', exact: true }).click();
    await notice.getByText('Couldn’t send that. Try again.', { exact: true }).waitFor();
    assert.match(await notice.innerText(), /Kalle is holding a seat/);
    assert.equal(await page.getByTestId('friends-invitation-count').innerText(), '1');
    await assertNothingUnderNotice(page, 'Home after a failed Not now', viewport);
  } else if (name.endsWith('queue')) {
    assert.match(await notice.innerText(), /Kalle is holding a seat/);
    await notice.getByRole('button', { name: 'Not now', exact: true }).click();
    await page.getByText('Pekka wants to be friends', { exact: true }).waitFor();
    await notice.getByRole('button', { name: 'Not now', exact: true }).click();
    await page.getByText('Nora accepted. You’re friends now.', { exact: true }).waitFor();
    assert.equal(await page.getByTestId('friends-invitation-count').innerText(), '2');
  } else if (name.endsWith('too-late')) {
    assert.equal(await notice.innerText(), 'Kalle’s game started without you');
    assert.equal(await notice.getByRole('button').count(), 0);
  } else if (name.endsWith('linked')) {
    await notice
      .getByText('Request sent. You’ll be friends once Nora accepts.', { exact: true })
      .waitFor();
    assert.equal(await notice.getByRole('button').count(), 0);
  } else if (!name.endsWith('accepted')) {
    await notice.getByRole('button', { name: 'Not now', exact: true }).click();
    await notice.waitFor({ state: 'detached' });
    assert.equal(await page.getByTestId('friends-invitation-count').innerText(), '1');
  }
  if (name === 'friend-notice-request' && viewport.name === 'landscape') {
    await page.goto(
      new URL('/home?fixture=friend-request&safeArea=iphone-17-landscape', baseUrl).href
    );
    await notice.waitFor();
    await waitForScreenshotReady(page);
    await assertNothingUnderNotice(page, 'Home with landscape insets', viewport);
    await assertHomeHeaderClear(page, '/home', viewport);
  }
}

// Every header control and both play tiles take their own taps once in view: a
// guest's taller column once overflowed upward over Friends and Settings with
// landscape insets.
async function assertHomeHeaderClear(page, path, viewport) {
  if (!path.startsWith('/home')) return;
  await getStableBox(page.getByTestId('home-quick-game'), page);
  const covered = await page.evaluate(() => {
    const header = document.querySelector('[data-testid="home-header"]');
    const targets = [
      ...header.querySelectorAll('[role="button"], [role="link"]'),
      ...document.querySelectorAll(
        '[data-testid="home-quick-game"], [data-testid="home-play-online"]'
      ),
    ];
    return targets
      .filter((element) => {
        element.scrollIntoView({ block: 'nearest' });
        const { left, right, top, bottom } = element.getBoundingClientRect();
        const [x1, x2] = [left + (right - left) / 4, right - (right - left) / 4];
        const [y1, y2] = [top + (bottom - top) / 4, bottom - (bottom - top) / 4];
        const points = [
          [(left + right) / 2, (top + bottom) / 2],
          [x1, y1],
          [x2, y1],
          [x1, y2],
          [x2, y2],
        ];
        return points.some(([x, y]) => !element.contains(document.elementFromPoint(x, y)));
      })
      .map((element) => element.getAttribute('aria-label') || element.textContent.trim());
  });
  assert.deepEqual(covered, [], `Home's header or tiles are covered in ${viewport.name}`);
}

// The running update reads as a name and a day, with the sha and id under it
// for support; an embedded launch and an unnamed update say so plainly.
async function assertAppUpdate(page, { appUpdate, locale }) {
  const section = page.getByTestId('app-update-section');
  await section.scrollIntoViewIfNeeded();
  const sv = locale === 'sv';
  const id = '0199f3a2-7c41-7d2e-9b8a-5e6f1c2d3a4b';
  const [running, detail] = {
    named: [sv ? 'Vaasa-Boudreaux · 20 okt.' : 'Vaasa-Boudreaux · Oct 20', `5cca7d0\n${id}`],
    embedded: [sv ? 'Versionen som är inbyggd i appen' : 'The version built into the app', null],
    fallback: ['0199f3a2', id],
  }[appUpdate];
  assert.equal(await page.getByTestId('app-update-running').innerText(), running);
  const support = section.getByText(id, { exact: false });
  assert.equal(await support.count(), detail ? 1 : 0);
  if (detail) assert.equal(await support.innerText(), detail);
  await section.getByText(sv ? 'Byggnummer' : 'Build number', { exact: true }).waitFor();
  await section.getByText('Beta', { exact: true }).waitFor();
  await waitForScreenshotReady(page);
}

// The dev-only ad row sits inside About the app and, on the web, only says why it can't run.
async function assertTestAd(page) {
  const row = page.getByTestId('app-update-section').getByTestId('settings-test-ad');
  // The whole section, not just the row: a row half on screen scrolls only that far.
  await page.getByTestId('app-update-section').scrollIntoViewIfNeeded();
  await row.getByText('Show a test ad', { exact: true }).waitFor();
  await row.getByText('Ads need a phone', { exact: true }).waitFor();
  assert.equal(await row.getByRole('button').count(), 0, 'no ad button on the web');
  await waitForScreenshotReady(page);
}

// The panel is only for a player with Premium: the server's answer, Restore busy while it
// runs, Manage for the store. Without Premium, no panel and a Restore link at the bottom.
async function assertPremium(page, { premium, locale }, viewport) {
  const sv = locale === 'sv';
  const restoreName = sv ? 'Återställ köp' : 'Restore purchases';
  if (premium === 'none' || premium === 'restoring') {
    await page.getByTestId('settings-screen').waitFor();
    const link = page.getByTestId('settings-restore');
    await link.scrollIntoViewIfNeeded();
    assert.equal(await page.getByTestId('settings-premium').count(), 0, 'no Premium panel');
    assert.equal(await page.getByText(/Du har inte Premium|You don't have Premium/).count(), 0);
    assert.equal(await link.innerText(), restoreName);
    assert.equal(
      await link.isDisabled(),
      premium === 'restoring',
      'Restore is untappable only while it runs'
    );
    const box = await getStableBox(link, page);
    assert.ok(box.height >= 44, `${premium}: Restore is ${box.height}px tall`);
    const about = await page.getByTestId('app-update-section').boundingBox();
    assert.ok(box.y >= about.y + about.height, 'Restore comes after About the app');
    const last = await page.getByTestId('settings-screen').evaluate((root) => {
      const shown = [...root.querySelectorAll('[data-testid]')].filter(
        (node) => node.getBoundingClientRect().height > 0
      );
      return Math.max(...shown.map((node) => node.getBoundingClientRect().bottom));
    });
    assert.ok(box.y + box.height >= last - 1, 'Restore is the last thing on Settings');
    assertInsideViewport('Restore purchases', box, viewport);
    await waitForScreenshotReady(page);
    return;
  }
  assert.equal(await page.getByTestId('settings-restore').count(), 0, 'no link with Premium');
  const panel = page.getByTestId('settings-premium');
  await panel.scrollIntoViewIfNeeded();
  const text = await panel.innerText();
  if (premium === 'web') {
    assert.equal(
      text.replace(/\s+/g, ' ').trim(),
      sv
        ? 'Premium Premium hanteras i Pidro-appen på din telefon.'
        : 'Premium Premium is managed in the Pidro app on your phone.'
    );
  } else {
    const status = {
      until: sv ? 'Premium till 12 mars 2027' : 'Premium until 12 March 2027',
      lifetime: sv ? 'Premium för alltid' : 'Lifetime Premium',
    }[premium];
    assert.equal(await panel.getByTestId('premium-status').innerText(), status);
    const restore = panel.getByRole('button', { name: restoreName });
    assert.equal(await restore.count(), 1, 'one Restore purchases');
    assert.equal(await restore.isDisabled(), false, 'Restore is ready');
    const manage = panel.getByRole('button', {
      name: sv ? 'Hantera prenumeration' : 'Manage subscription',
    });
    assert.equal(await manage.count(), premium === 'until' ? 1 : 0, 'Manage only for the store');
    await panel
      .getByText(
        sv
          ? 'Premium hör till ditt App Store-konto. Det gäller på det Pidro-konto där du senast återställde det. Byt när du vill med Återställ köp.'
          : 'Premium belongs to your App Store account. It is active on the Pidro account you last restored it on. Switch it any time with Restore purchases.',
        { exact: true }
      )
      .waitFor();
    for (const button of await panel.getByRole('button').all()) {
      const box = await button.boundingBox();
      assert.ok(box.height >= 44, `${premium}: a button is ${box.height}px tall`);
    }
  }
  // The whole panel is on screen at once, on every size.
  const box = await panel.boundingBox();
  assertInsideViewport('Premium panel', box, viewport);
  await waitForScreenshotReady(page);
}

const PREMIUM_SHEET_COPY = {
  en: {
    title: 'Pidro Premium',
    lines: ['No ads', 'Every felt and card back, when themes arrive', 'Keeps Pidro going'],
    yearly: ['Yearly', '$2.08 a month', '$24.99', 'a year'],
    monthly: ['Monthly', '$4.99', 'a month'],
    subscribe: 'Subscribe',
    retry: 'Try again',
    renews: '$24.99 a year, renews until you cancel. Cancel any time in your App Store account.',
    links: ['Restore purchases', 'Terms', 'Privacy'],
    failed: 'The purchase did not go through.',
    waiting: [
      'Almost there',
      'The App Store is still confirming your purchase. Premium turns on by itself when it does. You can close this and play.',
    ],
    bought: [
      'You are Premium',
      'Until 11 November 2027. It renews by itself; turn that off any time in your App Store account.',
    ],
    done: 'Done',
    deal: 'Deal the cards',
    close: 'Close',
    empty: 'Premium cannot be bought right now. Try again in a little while.',
    keep: 'Keep your progress',
  },
  sv: {
    title: 'Pidro Premium',
    lines: [
      'Ingen reklam',
      'Alla bordsdukar och kortbaksidor, när teman kommer',
      'Håller Pidro igång',
    ],
    yearly: ['Årsvis', '$2.08 per månad', '$24.99', 'per år'],
    monthly: ['Månadsvis', '$4.99', 'per månad'],
    subscribe: 'Prenumerera',
    retry: 'Försök igen',
    renews:
      '$24.99 per år, förnyas tills du säger upp. Säg upp när du vill i ditt App Store-konto.',
    links: ['Återställ köp', 'Villkor', 'Integritet'],
    failed: 'Köpet gick inte igenom.',
    waiting: [
      'Nästan klart',
      'App Store bekräftar fortfarande ditt köp. Premium slås på av sig självt när det är klart. Du kan stänga det här och spela.',
    ],
    bought: [
      'Du har Premium',
      'Till 11 november 2027. Det förnyas av sig självt; stäng av det när du vill i ditt App Store-konto.',
    ],
    done: 'Klar',
    deal: 'Dela ut korten',
    close: 'Stäng',
    empty: 'Premium går inte att köpa just nu. Försök igen om en stund.',
    keep: 'Behåll dina framsteg',
  },
};

// PID-126: the board's words, yearly first and chosen, the one-time package left out, no
// badge or crossed-out price, 44pt targets, and the wood or closing button reachable.
async function assertPremiumSheet(page, testCase, viewport) {
  const state = testCase.premiumSheet;
  const copy = PREMIUM_SHEET_COPY[testCase.locale];
  const sheet = page.getByTestId('premium-sheet');
  await sheet.waitFor();
  const text = (await sheet.innerText()).replace(/\s+/g, ' ');
  const has = (line) => assert.ok(text.includes(line), `${testCase.name}: "${line}" in ${text}`);
  assert.doesNotMatch(text, /119|%|!/, `${testCase.name}: no one-time package, discount or shout`);
  const choosing = ['choose', 'buying', 'failed'].includes(state);
  const radios = sheet.getByRole('radio');
  assert.equal(await radios.count(), choosing ? 2 : 0, `${testCase.name}: plan rows`);
  if (choosing) {
    [
      copy.title,
      ...copy.lines,
      ...copy.yearly,
      ...copy.monthly,
      copy.renews,
      ...copy.links,
    ].forEach(has);
    assert.deepEqual(
      await radios.evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-checked'))),
      ['true', 'false'],
      'yearly first, and chosen'
    );
    // One snapshot: the sheet may still be sliding up.
    const [yearly, monthly] = await radios.evaluateAll((rows) =>
      rows.map((row) => [row.dataset.testid, row.getBoundingClientRect().y])
    );
    assert.equal(yearly[0], 'premium-plan-yearly');
    assert.ok(yearly[1] < monthly[1], 'yearly above monthly');
    const subscribe = sheet.getByTestId('premium-subscribe');
    const busy = state === 'buying';
    assert.equal(await subscribe.getByRole('progressbar').count(), busy ? 1 : 0, 'busy');
    if (!busy) has(state === 'failed' ? copy.retry : copy.subscribe);
    assert.equal(text.includes(copy.failed), state === 'failed', `${testCase.name}: failed line`);
    for (const radio of await radios.all())
      assert.equal((await radio.getAttribute('aria-disabled')) === 'true', busy, 'rows locked');
    await subscribe.scrollIntoViewIfNeeded();
    assertInsideViewport(
      `${testCase.name} Subscribe`,
      await getStableBox(subscribe, page),
      viewport
    );
  } else if (state === 'empty') {
    [copy.title, copy.empty, copy.close].forEach(has);
  } else if (state === 'waiting') {
    [...copy.waiting, copy.close].forEach(has);
  } else {
    [...copy.bought, state === 'bought-ad' ? copy.deal : copy.done].forEach(has);
    if (state === 'bought-guest')
      await page.getByTestId('keep-progress-prompt').getByText(copy.keep).waitFor();
  }
  const action = sheet.getByTestId(
    choosing ? 'premium-subscribe' : state.startsWith('bought') ? 'premium-done' : 'premium-close'
  );
  await action.scrollIntoViewIfNeeded();
  assertInsideViewport(`${testCase.name} action`, await getStableBox(action, page), viewport);
  for (const button of await sheet.getByRole('button').all()) {
    const box = await button.boundingBox();
    if (box) assert.ok(box.height >= 44, `${testCase.name}: a button is ${box.height}px tall`);
  }
  await waitForScreenshotReady(page);
}

const AD_COPY = {
  en: {
    title: 'A short ad, then we deal',
    watch: 'Watch the ad',
    premium: 'Go Premium',
    free: 'Online tables are always free',
    close: 'Not now',
    dismissed: 'The ad stopped before the end. Watch it to the end and we deal.',
    unavailable: 'No ad right now, so we deal.',
  },
  sv: {
    title: 'En kort reklam, sedan delar vi ut',
    watch: 'Se reklamen',
    premium: 'Skaffa Premium',
    free: 'Bord online är alltid gratis',
    close: 'Inte nu',
    dismissed: 'Reklamen stängdes före slutet. Se den till slutet så delar vi ut.',
    unavailable: 'Ingen reklam just nu, så vi delar ut.',
  },
};

// PID-120: one calm choice. Watch the ad is busy while it loads and while we deal; nothing
// counts down, nothing is counted, nothing shouts, and the whole window fits without scrolling.
async function assertAdSheet(page, testCase, viewport) {
  const state = testCase.adSheet;
  if (!state) return;
  const copy = AD_COPY[testCase.locale];
  const body = page.getByTestId('ad-sheet');
  const title = page.getByText(copy.title, { exact: true });
  await title.waitFor();
  const window = title.locator('xpath=ancestor::*[.//*[@data-testid="ad-sheet"]][1]');
  const windowBox = await getStableBox(window, page);
  assertInsideViewport(`${testCase.name} window`, windowBox, viewport);
  const outside = await window.evaluate((root) =>
    [...root.querySelectorAll('*')]
      .filter((node) => node.getClientRects().length && !node.closest('[role="progressbar"]'))
      .filter((node) => {
        const box = node.getBoundingClientRect();
        return (
          box.top < 0 ||
          box.left < 0 ||
          box.bottom > innerHeight + 1 ||
          box.right > innerWidth + 1 ||
          (getComputedStyle(node).overflowY !== 'visible' &&
            node.scrollHeight > node.clientHeight + 2)
        );
      })
      .map((node) => node.textContent || node.tagName)
  );
  assert.deepEqual(outside, [], `${testCase.name}: the sheet clips or scrolls`);
  const text = await window.innerText();
  assert.doesNotMatch(text, /[0-9!]/, `${testCase.name}: no countdown, count or exclamation`);

  const watch = body.getByTestId('ad-watch');
  const busy = state === 'loading' || state === 'unavailable';
  assert.equal(await watch.getByRole('progressbar').count(), busy ? 1 : 0, `${testCase.name} busy`);
  assert.equal((await watch.getAttribute('aria-disabled')) === 'true', busy);
  if (!busy) await watch.getByText(copy.watch, { exact: true }).waitFor();
  await body.getByTestId('ad-premium').getByText(copy.premium, { exact: true }).waitFor();
  await body.getByText(copy.free, { exact: true }).waitFor();
  await body.getByRole('button', { name: copy.close, exact: true }).waitFor();
  for (const id of ['ad-watch', 'ad-premium', 'ad-close']) {
    const box = await getStableBox(body.getByTestId(id), page);
    assert.ok(box.height >= 44 && box.width >= 44, `${testCase.name} ${id}: 44pt target`);
    assertInsideViewport(`${testCase.name} ${id}`, box, viewport);
  }
  // While the cards are dealt, nothing else can be chosen.
  for (const id of ['ad-premium', 'ad-close'])
    assert.equal(
      (await body.getByTestId(id).getAttribute('aria-disabled')) === 'true',
      state === 'unavailable',
      `${testCase.name} ${id} disabled`
    );
  for (const line of ['dismissed', 'unavailable'])
    assert.equal(
      await body.getByText(copy[line], { exact: true }).count(),
      state === line ? 1 : 0,
      `${testCase.name}: the ${line} line`
    );
  await waitForScreenshotReady(page);
}

// Privacy is its own section after the game settings and before About the app; without
// the fixture a browser never shows it, heading included.
async function assertPrivacyChoices(page, testCase) {
  const sv = testCase.locale === 'sv';
  const heading = sv ? 'Integritet' : 'Privacy';
  const section = page.getByTestId('settings-privacy-choices');
  await section.scrollIntoViewIfNeeded();
  await section.getByText(heading, { exact: true }).waitFor();
  assert.equal(
    await page.getByTestId('app-update-section').getByTestId('settings-privacy-choices').count(),
    0,
    'not inside About the app'
  );
  const box = await getStableBox(section, page);
  const pace = await page.getByTestId('settings-pace').boundingBox();
  const about = await page.getByTestId('app-update-section').boundingBox();
  assert.ok(box.y >= pace.y + pace.height, 'after the game settings');
  assert.ok(box.y + box.height <= about.y, 'before About the app');
  const button = section.getByRole('button', { name: sv ? 'Integritetsval' : 'Privacy choices' });
  assert.ok((await getStableBox(button, page)).height >= 44, `${testCase.name}: 44pt target`);
  await section
    .getByText(sv ? 'Ändra vad du har godkänt för reklam.' : 'Change what you agreed to for ads.')
    .waitFor();
  await page.goto(`${baseUrl}/ui-dev?state=settings&locale=${testCase.locale}`);
  await page.getByTestId('app-update-section').waitFor();
  assert.equal(await section.count(), 0, 'hidden unless required');
  assert.equal(await page.getByText(heading, { exact: true }).count(), 0, 'no empty heading');
  await page.goBack();
  await section.scrollIntoViewIfNeeded();
  await waitForScreenshotReady(page);
}

// Retired notice routes remain as controls: neither OTA nor native upgrades show a banner.
async function assertUpdateNotice(page, name) {
  if (name.startsWith('update-notice') || name.startsWith('store-update-notice'))
    assert.equal(await page.getByTestId('update-notice').count(), 0, 'no shell update notice');
}

async function assertFocused(locator, message) {
  if (!(await locator.evaluate((input) => input === document.activeElement))) {
    throw new Error(message);
  }
}

const ruleLabels = { finnish: 'Ostrobothnian', louisiana: 'Louisiana' };
const ruleFacts = {
  finnish: [
    'Only trumps are played, including the same-color five.',
    'The highest trump wins the trick.',
    'A player with no trumps sits out for the rest of the hand.',
    'The minimum bid is 6.',
  ],
  louisiana: [
    'Non-trumps are played: follow the led suit or play a trump. When trump is led, follow trump if you can.',
    'The highest trump wins. With no trump, the highest card of the led suit wins.',
    'Nobody sits out. Every player plays all six tricks.',
    'The minimum bid is 7.',
  ],
};

async function assertRulesExplainer(page, ruleSet) {
  await page.getByTestId('rules-explainer').waitFor();
  assert.ok(
    (await page.getByTestId('rules-explainer-rule-set').innerText()).includes(ruleLabels[ruleSet])
  );
  for (const [index, fact] of ruleFacts[ruleSet].entries()) {
    assert.equal(await page.getByTestId(`rules-fact-${index}`).innerText(), fact);
  }
  assert.equal(
    await page.getByTestId('rules-feedback').innerText(),
    'Not the rules you play? Tell us'
  );
  assert.equal(await page.getByTestId('rules-done').innerText(), 'Got it');
}

async function assertRulePresentation(page, testCase) {
  const ruleSet = testCase.ruleSet ?? 'finnish';
  const badge =
    testCase.rulesBadge ??
    {
      'table-waiting': 'waiting-rule-set',
    }[testCase.name];
  if (badge && !testCase.rulesExplainer) {
    await page.getByTestId(badge).waitFor();
    assert.ok(
      (badge === 'waiting-rule-set'
        ? await page.getByTestId(badge).innerText()
        : await page.getByTestId(badge).getAttribute('aria-label')
      ).includes(ruleLabels[ruleSet])
    );
  }
  if (testCase.rulesSelector) {
    const selector = page.getByTestId(testCase.rulesSelector);
    await selector.waitFor();
    assert.equal(
      await selector
        .getByRole('button', { name: new RegExp(ruleLabels[ruleSet]) })
        .getAttribute('aria-selected'),
      'true'
    );
  }
  if (badge === 'invite-rule-set') {
    if (testCase.authenticated)
      await page.getByText('Ready to join as Bengt.', { exact: true }).waitFor();
    else await page.getByLabel('Your display name', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Join table', exact: true }).waitFor();
  }
  if (testCase.rulesExplainer) await assertRulesExplainer(page, ruleSet);
  if (testCase.name === 'table-louisiana-bidding') {
    await page.getByTestId('bidding-window').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Bid 6', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Bid 7', exact: true }).isEnabled(), true);
    assert.equal(
      boxesOverlap(
        await page.getByTestId('bidding-window').boundingBox(),
        await page.getByTestId('table-rule-set').boundingBox()
      ),
      false
    );
  }
}

async function assertFriendsPresentation(page, name) {
  const swedish = name.startsWith('locale-sv-');
  name = name.replace(/^locale-sv-/, '');
  if (name.startsWith('blocked-')) {
    await page
      .getByText(
        swedish
          ? 'Att avblockera någon lägger inte till personen som vän igen.'
          : 'Unblocking does not add them back as a friend.',
        { exact: true }
      )
      .waitFor();
    const expected = {
      'blocked-empty': [swedish ? 'Du har inte blockerat någon.' : 'You have not blocked anyone.'],
      'blocked-filled': ['Nora', 'Pekka'],
      'blocked-loading': [swedish ? 'Laddar…' : 'Loading…'],
      'blocked-error': [
        swedish
          ? 'Kunde inte uppdatera blockerade spelare. Försök igen.'
          : 'Could not update blocked players. Please try again.',
      ],
    }[name];
    for (const text of expected) await page.getByText(text, { exact: true }).first().waitFor();
    assert.equal(
      await page.getByRole('button', { name: swedish ? /^Avblockera / : /^Unblock / }).count(),
      name === 'blocked-filled' ? 2 : 0
    );
    assert.equal(await page.getByText('Online', { exact: true }).count(), 0);
    if (!swedish) {
      await page.getByRole('button', { name: 'Home', exact: true }).click();
      await page.waitForURL('**/home');
    }
    return;
  }
  // PID-406: Kalle's sheet over the table, as on `Tap a seat: the player sheet`.
  if (name === 'player-sheet-kalle') {
    const sheet = page.getByTestId('player-sheet');
    for (const words of [
      'Kalle',
      'Legend · Plays against you',
      'Old Pidro since 2014',
      '10,420',
      '53%',
      '7 of 10',
      'Newest: Homerun. Bid 14 and made it.',
      'You two: 23 games together',
      '14 won as partners · 4 of 9 against each other',
      'Add friend',
    ])
      await sheet.getByText(words, { exact: true }).waitFor();
    // At the table the seat says where they are; the medal count moved into its box.
    assert.equal(await sheet.getByText('At your table', { exact: false }).count(), 0);
    assert.equal(await sheet.getByText('medals', { exact: true }).count(), 0);
    assert.equal((await sheet.getByTestId('player-sheet-avatar-level').innerText()).trim(), '100');
    assert.equal(
      await sheet.getByTestId('player-sheet-avatar-pin').count(),
      1,
      'the pin is on the sheet'
    );
    return;
  }
  if (name === 'lobby-player-sheet') {
    // Only people open a sheet: OPEN2 seats Yaya beside a bot and two open chairs.
    assert.equal(await page.locator('[data-testid^="lobby-player-OPEN2-"]').count(), 1);
    await page.getByRole('button', { name: 'View Claas’s profile', exact: true }).first().click();
    const sheet = page.getByTestId('player-sheet');
    await sheet.getByText('Claas', { exact: true }).waitFor();
    await sheet.getByText('Legend ★4', { exact: true }).waitFor();
    await sheet.getByText('Online now', { exact: true }).waitFor();
    return;
  }
  // PID-340: Block waits behind the sheet's "…"; a guest has neither and
  // reads that a free account is needed to add anyone.
  if (name.startsWith('block-profile-')) {
    const sheet = page.getByTestId('player-sheet');
    await sheet.getByText('mfios1', { exact: true }).waitFor();
    await sheet
      .getByTestId('player-sheet-title')
      .getByText(/^Apprentice/)
      .waitFor();
    if (name === 'block-profile-guest') {
      assert.equal(await sheet.getByTestId('player-sheet-more').count(), 0);
      // Game over: no game left to save after, so the plain line.
      await sheet.getByText('Needs a free account', { exact: true }).waitFor();
      return;
    }
    await sheet.getByTestId('player-sheet-add').waitFor();
    await sheet.getByTestId('player-sheet-more').click();
    await sheet.getByTestId('player-sheet-block').click();
    await sheet.getByRole('button', { name: 'Block', exact: true }).waitFor();
    return;
  }
  if (!name.startsWith('friends-')) return;
  if (name === 'friends-link-profile') {
    const profile = page.getByTestId('player-sheet');
    const add = profile.getByRole('button', {
      name: swedish ? 'Lägg till Nora' : 'Add Nora',
      exact: true,
    });
    await profile.getByText('Nora', { exact: true }).waitFor();
    await add.click();
    await profile
      .getByText(swedish ? 'Vänförfrågan skickad' : 'Friend request sent', { exact: true })
      .waitFor();
    assert.equal(await add.count(), 0);
    return;
  }
  if (name.startsWith('friends-sheet-')) {
    const state = name.slice('friends-sheet-'.length);
    const sheet = page.getByTestId('friend-sheet');
    const words = swedish
      ? {
          partner: ['Vid ett bord · partnerplats ledig', 'Du spelar som partner till Nora.'],
          opponent: ['Vid ett bord · motståndarplats ledig', 'Du spelar mot Nora.'],
          full: ['Vid ett bord · inga lediga platser'],
          online: ['Spela tillsammans', 'Startar ett nytt bord med Nora som din partner.'],
          bots: ['Spela tillsammans', 'Startar ett nytt bord med Nora som din partner.'],
          offline: ['Spela tillsammans', 'Din inbjudan väntar på Nora i Pidro.'],
          request: ['Acceptera'],
          remove: [
            'Ta bort Nora från dina vänner?',
            'Ni tas bort från varandras vänlistor. Nora får inget meddelande.',
            'Behåll Nora',
          ],
          block: [
            'Blockera Nora?',
            'Nora kan inte hitta dig, lägga till dig eller sätta sig vid dina bord, och ni är inte längre vänner. Du kan avblockera Nora när som helst i Profil.',
          ],
        }
      : {
          partner: ['At a table · partner seat free', 'You’ll play as Nora’s partner.'],
          opponent: ['At a table · opponent seat free', 'You’ll play against Nora.'],
          full: ['At a table · no free seats'],
          online: ['Play together', 'Starts a new table with Nora as your partner.'],
          bots: ['Play together', 'Starts a new table with Nora as your partner.'],
          offline: ['Play together', 'Your invitation waits for Nora in Pidro.'],
          request: ['Accept'],
          remove: [
            'Remove Nora from your friends?',
            'You’ll leave each other’s friends lists. Nora won’t be told.',
            'Keep Nora',
          ],
          block: [
            'Block Nora?',
            'Nora won’t be able to find you, add you or sit at your tables, and you won’t be friends anymore. You can unblock Nora any time in Profile.',
          ],
        };
    for (const word of words[state]) await sheet.getByText(word, { exact: true }).waitFor();
    if (state === 'full')
      assert.equal(
        await sheet.getByRole('button', { name: /^(Join|Play|Gå med|Spela)/ }).count(),
        0
      );
    const overflow = await sheet.evaluate(
      (root) =>
        [...root.querySelectorAll('*')].filter(
          (el) => el.scrollHeight > el.clientHeight + 2 && getComputedStyle(el).overflowY === 'auto'
        ).length
    );
    assert.equal(overflow, 0, `${name}: the short profile must not scroll`);
    if (state === 'remove' || state === 'block') {
      await sheet
        .getByRole('button', {
          name:
            state === 'remove'
              ? swedish
                ? 'Behåll Nora'
                : 'Keep Nora'
              : swedish
                ? 'Avbryt'
                : 'Cancel',
          exact: true,
        })
        .click();
      await sheet
        .getByRole('button', {
          name: swedish ? 'Visa hela profilen' : 'See full profile',
          exact: true,
        })
        .waitFor();
    }
    return;
  }
  if (name === 'friends-classic') {
    const footer = page.getByTestId('friends-classic-count');
    await footer
      .getByText(
        swedish
          ? '7 vänner från din gamla Pidro-app är inte här än'
          : '7 friends from your old Pidro app aren’t here yet',
        { exact: true }
      )
      .waitFor();
    const lastFriend = page.getByRole('button', {
      name: swedish ? 'Visa profilen för Liisa' : 'View Liisa’s profile',
      exact: true,
    });
    assert.ok(
      (await footer.boundingBox()).y >=
        (await lastFriend.boundingBox()).y + (await lastFriend.boundingBox()).height
    );
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async () => {
          throw new Error('Share unavailable');
        },
      });
    });
    const share = footer.getByRole('button', {
      name: swedish ? 'Berätta om nya appen' : 'Tell them about the new app',
      exact: true,
    });
    await share.click();
    await footer
      .getByText(
        swedish ? 'Delningsmenyn kunde inte öppnas.' : 'The share sheet could not be opened.',
        { exact: true }
      )
      .waitFor();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data) => {
          window.__appShare = data;
        },
      });
    });
    await share.click();
    assert.equal(
      await page.evaluate(() => window.__appShare.text),
      swedish
        ? 'Kom och spela Pidro med mig 🃏 https://www.pidro.online/beta'
        : 'Come play Pidro with me 🃏 https://www.pidro.online/beta'
    );
    assert.equal(await footer.getByRole('alert').count(), 0);
    // Send your link comes last, below the Classic card, and shares the player's own link.
    const link = page.getByTestId('friends-link-card');
    assert.ok(
      (await link.boundingBox()).y >=
        (await footer.boundingBox()).y + (await footer.boundingBox()).height
    );
    await link
      .getByRole('button', { name: swedish ? 'Skicka din länk' : 'Send your link', exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => window.__appShare.text),
      swedish
        ? 'Kom och spela Pidro med mig: https://www.pidro.online/beta'
        : 'Come play Pidro with me: https://www.pidro.online/beta'
    );
  } else if (name !== 'friends-all' && name !== 'friends-empty') {
    assert.equal(await page.getByTestId('friends-classic-count').count(), 0);
  }
  const expected =
    (swedish
      ? {
          'friends-empty': [
            'Lägg till dem du tycker om att spela med. När de tackat ja ser du när de är online och kan bjuda in dem till ditt bord.',
            'Spelat med nyligen',
            'Sanna',
            'Erkki',
            'Ville',
            'Idag',
            'Igår',
            'För 2 dagar sedan',
            '38 vänner från din gamla Pidro-app är inte här än',
          ],
          'friends-list': [
            '6 vänner · 3 online',
            'Frågade idag',
            'Frågade för 3 dagar sedan',
            'Vid ett bord · 1 ledig plats',
            'Vid ett bord · giv 4',
            'Ledig att spela',
            'Spelade igår',
            'Spelade förra veckan',
            'Spelade i september',
            'Förfrågan skickad för 2 dagar sedan',
          ],
          'friends-added-you': ['Vill bli vänner', 'Kalle', 'Acceptera'],
          'friends-loading': ['Laddar…'],
          'friends-error': ['Kunde inte uppdatera Vänner. Försök igen.', 'Försök igen'],
          'friends-recent': [
            'Spelat med nyligen',
            'Sanna',
            'Spelade tillsammans idag',
            'Nora',
            'Pekka',
            'Eero',
            'Skickad',
            'Vänner',
            'Din vän',
            'Vill bli vänner',
            'Väntar på att Eero tackar ja',
            'Skicka din länk',
          ],
          'friends-results': [
            'Sökresultat',
            'Vänner',
            'Vill bli vänner',
            'Skickad',
            'Skicka din länk',
          ],
          'friends-profile': ['Nora', 'Vänner'],
          'friends-remove': ['Ta bort Nora från dina vänner?', 'Behåll Nora'],
          'friends-block': ['Blockera Nora?', 'Avbryt'],
          'friends-guest': ['Spara din spelare', 'Spara konto'],
        }
      : {
          'friends-empty': [
            'Add the people you like playing with. Once they accept, you’ll see when they’re online and can invite them to your table.',
            'Played with recently',
            'Sanna',
            'Erkki',
            'Ville',
            'Today',
            'Yesterday',
            '2 days ago',
            '38 friends from your old Pidro app aren’t here yet',
          ],
          'friends-list': [
            '6 friends · 3 online',
            'Asked today',
            'Asked 3 days ago',
            'At a table · 1 seat open',
            'At a table · hand 4',
            'Free to play',
            'Played yesterday',
            'Played last week',
            'Played in September',
            'Request sent 2 days ago',
          ],
          'friends-added-you': ['Want to be friends', 'Kalle', 'Accept'],
          'friends-loading': ['Loading…'],
          'friends-error': ['Could not update Friends. Please try again.', 'Retry'],
          'friends-recent': [
            'Played with recently',
            'Sanna',
            'Played together today',
            'Nora',
            'Pekka',
            'Eero',
            'Sent',
            'Friends',
            'Your friend',
            'Wants to be friends',
            'Waiting for Eero to accept',
            'Send your link',
          ],
          'friends-results': [
            'Search results',
            'Friends',
            'Wants to be friends',
            'Sent',
            'Send your link',
          ],
          'friends-profile': ['Nora', 'Friends'],
          'friends-remove': ['Remove Nora from your friends?', 'Keep Nora'],
          'friends-block': ['Block Nora?', 'Cancel'],
          'friends-guest': ['Save your player', 'Save account'],
        })[name] ?? [];
  for (const text of expected) await page.getByText(text, { exact: true }).first().waitFor();
  if (name === 'friends-empty') {
    // As on the board: help, recent players and the Classic card, on one screen
    // from a 375×667 phone up (a 360×640 phone in Swedish scrolls a little).
    assert.equal(await page.getByTestId('friends-link-card').count(), 0);
    const { width, height } = page.viewportSize();
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll('*')]
        .filter(
          (el) =>
            el.scrollHeight > el.clientHeight + 2 &&
            ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)
        )
        .map((el) => el.scrollHeight - el.clientHeight)
    );
    if (Math.min(width, height) >= 375 && Math.max(width, height) >= 667)
      assert.deepEqual(overflow, [], 'empty Friends must not scroll');
  }
  if (['friends-recent', 'friends-results', 'friends-empty'].includes(name)) {
    const list = page.getByTestId('friend-discovery');
    const before = await list.innerText();
    const firstName = name === 'friends-results' ? 'Nora' : 'Sanna';
    await page
      .getByRole('button', { name: `${swedish ? 'Lägg till' : 'Add'} ${firstName}`, exact: true })
      .click();
    await list
      .getByText(
        swedish ? `Väntar på att ${firstName} tackar ja` : `Waiting for ${firstName} to accept`,
        { exact: true }
      )
      .waitFor();
    assert.ok(before.includes(firstName));
    const toast = page.getByTestId('toast');
    await toast.waitFor();
    assertInsideViewport('sent toast', await toast.boundingBox(), page.viewportSize());
    await toast.waitFor({ state: 'hidden', timeout: 6000 });
    if (name !== 'friends-empty') {
      const acceptedName = name === 'friends-results' ? 'Noreen' : 'Pekka';
      await page
        .getByRole('button', {
          name: `${swedish ? 'Acceptera' : 'Accept'} ${acceptedName}`,
          exact: true,
        })
        .click();
      assert.equal(
        await list.getByText(swedish ? 'Din vän' : 'Your friend', { exact: true }).count(),
        2
      );
      await page.evaluate(() =>
        Object.defineProperty(navigator, 'share', {
          configurable: true,
          value: async (data) => {
            window.__friendShare = data;
          },
        })
      );
      await page
        .getByRole('button', { name: swedish ? 'Skicka din länk' : 'Send your link', exact: true })
        .click();
      assert.equal(
        await page.evaluate(() => window.__friendShare.text),
        swedish
          ? 'Kom och spela Pidro med mig: https://www.pidro.online/beta'
          : 'Come play Pidro with me: https://www.pidro.online/beta'
      );
    }
  }
  if (name === 'friends-all') {
    for (const text of swedish
      ? [
          '4 vänner · 3 online',
          'Vill bli vänner',
          'Online nu',
          'Inte online',
          'Väntar på svar',
          'Förfrågan skickad för 2 dagar sedan',
          '38 vänner från din gamla Pidro-app är inte här än',
        ]
      : [
          '4 friends · 3 online',
          'Want to be friends',
          'Online now',
          'Not online',
          'Waiting for an answer',
          'Request sent 2 days ago',
          '38 friends from your old Pidro app aren’t here yet',
        ])
      await page.getByText(text, { exact: true }).first().waitFor();
    assert.equal(
      await page
        .getByRole('button', {
          name: swedish ? 'Gå med vid Noras bord' : 'Join Nora’s table',
          exact: true,
        })
        .count(),
      1
    );
    assert.equal(
      await page
        .getByRole('button', {
          name: swedish ? 'Starta ett bord med Maija' : 'Start a table with Maija',
          exact: true,
        })
        .count(),
      1
    );
    assert.equal(
      await page
        .getByRole('button', {
          name: swedish
            ? /(?:Gå med vid Kalles|Starta ett bord med Kalle|Titta)/
            : /(?:Join Kalle|Start a table with Kalle|Watch)/,
        })
        .count(),
      0
    );
    const accept = page.getByRole('button', {
      name: swedish ? 'Acceptera Pekka' : 'Accept Pekka',
      exact: true,
    });
    const undo = page.getByRole('button', { name: swedish ? 'Ångra' : 'Undo', exact: true });
    await page
      .getByRole('button', {
        name: swedish ? 'Dölj förfrågan från Pekka' : 'Ignore Pekka’s request',
        exact: true,
      })
      .click();
    assert.equal(await accept.count(), 0);
    const toast = page.getByTestId('toast');
    await toast
      .getByText(
        swedish
          ? 'Förfrågan dold. Pekka får inget meddelande.'
          : 'Request hidden. Pekka won’t be told.',
        { exact: true }
      )
      .waitFor();
    assertInsideViewport('toast', await toast.boundingBox(), page.viewportSize());
    await undo.click();
    await accept.waitFor();
    await page
      .getByRole('button', {
        name: swedish ? 'Avbryt din vänförfrågan till Eero' : 'Cancel your friend request to Eero',
        exact: true,
      })
      .click();
    await toast
      .getByText(
        swedish
          ? 'Förfrågan avbruten. Eero får inget meddelande.'
          : 'Request cancelled. Eero won’t be told.',
        { exact: true }
      )
      .waitFor();
    assert.equal(await undo.count(), 0);
    assert.equal(await page.getByTestId('friends-sent').count(), 0);
    await toast.waitFor({ state: 'hidden', timeout: 6000 });
  }
  if (name === 'friends-added-you') {
    assert.ok(
      (
        await page
          .getByRole('heading', {
            name: swedish ? 'Vill bli vänner' : 'Want to be friends',
            exact: true,
          })
          .boundingBox()
      ).y <
        (
          await page
            .getByRole('button', {
              name: swedish ? 'Visa profilen för Nora' : 'View Nora’s profile',
            })
            .boundingBox()
        ).y
    );
  }
  if (name === 'friends-remove' || name === 'friends-block') {
    await page
      .getByRole('button', {
        name:
          name === 'friends-remove'
            ? swedish
              ? 'Behåll Nora'
              : 'Keep Nora'
            : swedish
              ? 'Avbryt'
              : 'Cancel',
        exact: true,
      })
      .click();
    await page.getByRole('button', { name: swedish ? 'Stäng' : 'Close', exact: true }).click();
    await page
      .getByRole('button', { name: swedish ? 'Visa profilen för Nora' : 'View Nora’s profile' })
      .waitFor();
  }
  if (name === 'friends-guest') {
    for (const label of swedish
      ? ['Offentligt namn', 'E-post', 'Lösenord']
      : ['Public name', 'Email', 'Password']) {
      const box = await page.getByRole('textbox', { name: label, exact: true }).boundingBox();
      assert.ok(
        box && box.x >= 0 && box.x + box.width <= page.viewportSize().width,
        `${label} clipped`
      );
    }
  }
}

async function assertLobbyPresentation(page, testCase) {
  const fixture = testCase.lobbyFixture;
  if (!fixture) return;
  assert.equal(await page.getByTestId('lobby-rule-filter').count(), 0);
  // Upright phones pin Start a table over the list: no box behind it, and md, not lg.
  const start = page.getByTestId('lobby-start');
  const size = page.viewportSize();
  if (fixture !== 'empty' && size.width < 600 && size.height > size.width)
    assert.equal(await start.count(), 1, 'upright phones pin the start button');
  if (await start.count()) {
    assert.deepEqual(
      await start.evaluate((node) => {
        const style = getComputedStyle(node);
        return [style.backgroundImage, style.backgroundColor];
      }),
      ['none', 'rgba(0, 0, 0, 0)'],
      'no fade behind the start button'
    );
    const button = start.getByRole('button', { name: 'Start a table', exact: true });
    assert.ok((await getStableBox(button, page)).height < 60, 'the start button is md');
  }
  if (fixture === 'empty') {
    await page.getByText('No one is at a table yet', { exact: true }).waitFor();
    return;
  }
  const search = page.getByRole('textbox', { name: 'Find a player', exact: true });
  await search.waitFor();
  if (fixture === 'search-empty') {
    assert.equal(await search.inputValue(), 'Nobody named this');
    await page.getByText('No matching tables', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    assert.equal(await search.inputValue(), '');
  }
  const row = (code) => page.getByTestId(`lobby-table-${code}`);
  if (['list', 'search-empty', 'rejoin'].includes(fixture)) {
    await row('MY').getByText('Your seat is waiting', { exact: true }).waitFor();
    assert.equal(await row('MY').getByRole('button', { name: 'Rejoin', exact: true }).count(), 1);
  }
  if (['list', 'search-empty', 'open', 'badges', 'locked'].includes(fixture)) {
    await row('OPEN1').getByText('Claas', { exact: true }).waitFor();
    assert.equal(await row('OPEN1').getByText('Open', { exact: true }).count(), 3);
    await row('OPEN1').getByText('3 seats open', { exact: true }).waitFor();
    await row('OPEN2').getByText('Yaya', { exact: true }).waitFor();
    assert.equal(await row('OPEN2').getByText('Marcel', { exact: true }).count(), 1);
    assert.equal(await row('OPEN2').getByText('Open', { exact: true }).count(), 2);
    await row('OPEN2').getByText('2 seats open', { exact: true }).waitFor();
    assert.equal(await row('OPEN1').getByTestId('seat-requirement').count(), 3);
    assert.equal(await row('OPEN2').getByTestId('seat-requirement').count(), 0);
    assert.equal(await row('OPEN3').getByTestId('seat-requirement').innerText(), '1,000+');
  }
  if (fixture === 'locked') {
    await row('OPEN1')
      .getByRole('button', {
        name: 'south seat locked, 100 games played needed, you have 40',
        exact: true,
      })
      .click();
    await row('OPEN1').getByRole('alert').waitFor();
    assert.equal(
      await row('OPEN1').getByRole('alert').innerText(),
      '100 games played needed, you have 40'
    );
  }
  if (['list', 'search-empty', 'substitute'].includes(fixture)) {
    for (const name of ['Anna', 'Pekka', 'Liisa', 'Jussi left in hand 3'])
      await row('SUB').getByText(name, { exact: true }).waitFor();
    assert.equal(
      await row('SUB')
        .getByRole('button', { name: /^Sit in .* seat$/ })
        .count(),
      1
    );
  }
  if (['list', 'search-empty', 'watch'].includes(fixture)) {
    await row('WATCH1').getByText('Hand 4 · 34 to 21', { exact: true }).waitFor();
    await row('WATCH2').getByText('Playing', { exact: true }).waitFor();
    for (const name of ['Marcel', 'Antti', 'Jocke']) {
      await row('WATCH2').getByText(name, { exact: true }).waitFor();
    }
    assert.equal(
      await row('WATCH1').getByRole('button', { name: 'Watch', exact: true }).count(),
      1
    );
  }
  for (const card of await page.getByTestId(/^lobby-table-/).all()) {
    assert.doesNotMatch(
      await card.innerText(),
      /Never show this table name|\b(?:MY|OPEN\d|SUB|WATCH\d)\b|Level \d/
    );
  }
  if (fixture !== 'list') return;
  await search.fill('  cLaAs  ');
  await row('OPEN1').waitFor();
  assert.equal(await page.getByTestId(/^lobby-table-/).count(), 1);
  for (const query of ['OPEN1', 'Never show this table name', 'Marcel']) {
    await search.fill(query);
    await page.getByText('No matching tables', { exact: true }).waitFor();
    assert.equal(await page.getByTestId(/^lobby-table-/).count(), 0);
  }
  await search.fill('');
  await row('OPEN1').waitFor();
}

// The password keypad (PID-259): the chair opens it, four digits send it, the
// answer clears the boxes, a wait dims the keys, and × closes it at any point.
async function assertPasswordKeypad(page, testCase, viewport) {
  if (!testCase.name.startsWith('lobby-password')) return;
  const keypad = page.getByTestId('password-keypad');
  const typed = (count) =>
    keypad.getByLabel(`Password, ${count} of 4 numbers typed`, { exact: true }).waitFor();
  const key = (name) => keypad.getByRole('button', { name, exact: true });
  if (testCase.insets) {
    const box = await getStableBox(keypad, page);
    assert.ok(box.x >= testCase.insets.left, `${testCase.name}: panel clears the left inset`);
    assert.ok(
      box.x + box.width <= viewport.width - testCase.insets.right,
      `${testCase.name}: panel clears the right inset`
    );
    assert.ok(box.y + box.height <= viewport.height - 21, `${testCase.name}: clears the home bar`);
  }
  if (testCase.name === 'lobby-password') {
    const row = page.getByTestId('lobby-table-LOCK');
    await row.getByText('Bertil', { exact: true }).waitFor();
    await row
      .getByRole('button', { name: 'Join south seat, needs a password', exact: true })
      .click();
    await keypad.waitFor();
    await keypad.getByText('This seat needs a password', { exact: true }).waitFor();
    for (const name of ['1', '0', 'Delete the last number']) {
      const box = await key(name).boundingBox();
      assert.ok(box.height >= 64, `${testCase.name}: key ${name} is at least 64pt tall`);
    }
    await keypad.getByText('Bertil’s table', { exact: true }).waitFor();
    await keypad.getByText('Ostrobothnian · Bertil’s partner', { exact: true }).waitFor();
    await keypad.getByText('Type the four numbers Bertil gave you.', { exact: true }).waitFor();
    // The fixture answers every password wrong.
    for (const digit of '4821') await key(digit).click();
    await keypad
      .getByText('That’s not it. Ask Bertil for the password.', { exact: true })
      .waitFor();
    await typed(0);
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
    await keypad.waitFor({ state: 'detached' });
    return;
  }
  if (testCase.name === 'lobby-password-wait') {
    const wait = keypad.getByText('Try again in a minute.', { exact: true });
    await wait.waitFor();
    // One line keeps the room of two, so the sheet does not jump after a two-line message.
    const line = await wait.boundingBox();
    assert.ok(line.height >= 43.5, `${testCase.name}: the message row holds two lines`);
    await typed(0);
    for (const name of ['1', '0', 'Delete the last number'])
      assert.equal(await key(name).isDisabled(), true, `${name} waits`);
  } else if (testCase.name === 'lobby-password-wrong') {
    await keypad
      .getByText('That’s not it. Ask Bertil for the password.', { exact: true })
      .waitFor();
    await key('7').click();
    await typed(1);
    await keypad.getByText('Type the four numbers Bertil gave you.', { exact: true }).waitFor();
  } else if (testCase.name !== 'lobby-password-keypad') {
    await typed(2);
    await key('Delete the last number').click();
    await typed(1);
  }
  await keypad.getByRole('button', { name: 'Close', exact: true }).click();
  await keypad.waitFor({ state: 'detached' });
}

async function assertCreationPresentation(page, testCase) {
  if (testCase.name === 'table-invite') {
    const dialog = page.getByTestId('invite-window');
    await dialog.getByRole('button', { name: /^Copy/ }).waitFor();
    await dialog.getByRole('button', { name: /^Share/ }).waitFor();
    assert.equal(await dialog.getByText(/^(north|south|east|west)$/i).count(), 0);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    return;
  }
  if (testCase.name === 'lobby-held') {
    const row = page.getByTestId('lobby-table-OPEN1');
    await row.getByText('Invited', { exact: true }).waitFor();
    assert.equal(await row.getByRole('button', { name: /^Join south seat/ }).count(), 0);
  }
  if (testCase.name === 'waiting-held')
    await page.getByText('Invited · not online yet', { exact: true }).waitFor();
  if (testCase.name.endsWith('-invitations')) {
    const inbox = page.getByTestId('seat-invitations');
    await inbox.getByText('Nora is holding a seat for you', { exact: true }).waitFor();
    await inbox.getByText('Kalle is holding a seat for you', { exact: true }).waitFor();
    assert.equal(await inbox.getByRole('button', { name: 'Sit down', exact: true }).count(), 2);
    if (testCase.name === 'home-invitations') {
      assert.equal(await page.getByTestId('friends-invitation-count').innerText(), '2');
      await page
        .getByRole('button', { name: 'Friends, 2 waiting for your answer', exact: true })
        .waitFor();
    }
  }
  const fixture = testCase.newTableFixture;
  if (!fixture) return;
  const viewport = page.viewportSize();
  await assertTeamLayout(page, viewport, testCase.name);
  if (fixture === 'reconnecting' || fixture.startsWith('ready-error')) {
    const sv = testCase.newTableLanguage === 'sv';
    if (fixture === 'reconnecting') {
      await page.getByText(sv ? 'Återansluter…' : 'Reconnecting…', { exact: true }).waitFor();
      await page
        .getByText(sv ? 'Väntar på Pedro1…' : 'Waiting for Pedro1…', { exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole('button', { name: sv ? 'Jag är redo' : "I'm ready", exact: true })
          .count(),
        0
      );
    } else {
      await page.getByTestId('waiting-error').waitFor();
    }
    await assertAccountSurfaceFits(page.getByTestId('waiting-table'), testCase.name, viewport);
  }
  if (fixture === 'setup')
    assert.equal(await page.getByText('Anyone can sit', { exact: true }).count(), 3);
  const footer = {
    setup: 'Open the table',
    bots: 'Start the game',
    opened: 'Share the table link',
    ready: "I'm ready",
  }[fixture];
  if (footer) await page.getByRole('button', { name: footer, exact: true }).waitFor();
  // Only the host's table is theirs; a player who joined sees whose it is.
  if (fixture === 'opened' || fixture === 'guest') {
    const title = fixture === 'guest' ? 'Bertil’s table' : 'Your table';
    await page.getByTestId('waiting-toolbar').getByText(title, { exact: true }).waitFor();
  }
  if (fixture === 'setup' || fixture === 'louisiana') {
    const selected = page.getByRole('radio', {
      name: fixture === 'louisiana' ? 'Louisiana' : 'Ostrobothnian',
      exact: true,
    });
    assert.equal(await selected.getAttribute('aria-checked'), 'true');
  }
  if (fixture === 'picker' || fixture === 'live-picker')
    await page.getByTestId('seat-picker-container').waitFor();
  if (fixture === 'live-picker')
    assert.equal(
      await page.getByRole('radio', { name: /^With password 4821, / }).getAttribute('aria-checked'),
      'true',
      'the live picker reopens on the seat as the server has it'
    );
  if (fixture === 'friends' || fixture === 'live-friends')
    await page.getByTestId('friend-picker').waitFor();
  // PID-410: a bot seat shows who sits there, and its picker opens on them.
  if (fixture === 'characters')
    assert.match(await page.getByTestId('new-table-seat-south').innerText(), /Gun/);
  if (fixture.startsWith('bot-picker'))
    assert.equal(
      await page
        .getByTestId('bot-picker')
        .getByRole('radio', { name: fixture === 'bot-picker' ? /^Gun, / : /^Anyone, / })
        .getAttribute('aria-checked'),
      'true'
    );
  // The board's sideways picker: four rows of two friends, whole, above the bottom edge.
  if (fixture === 'picker' && viewport.width > viewport.height && viewport.height < 600) {
    const scroll = await page.getByTestId('friend-picker-scroll').boundingBox();
    assertInsideViewport('friend list', scroll, { name: testCase.name, ...viewport });
    const rows = await page
      .getByTestId('friend-picker-scroll')
      .getByRole('button')
      .evaluateAll((nodes) => nodes.map((node) => node.parentElement.getBoundingClientRect()));
    const whole = rows.filter(
      (row) => row.top >= scroll.y - 0.5 && row.bottom <= scroll.y + scroll.height + 0.5
    );
    assert.ok(whole.length >= 8, `${whole.length} whole friend rows in the sideways picker`);
    // The board's ✕ is a round glass button, not a bare glyph.
    const close = page
      .getByTestId('seat-picker-container')
      .getByRole('button', { name: 'Cancel', exact: true });
    const background = await close.evaluate(
      (node) => getComputedStyle(node).backgroundImage + getComputedStyle(node).backgroundColor
    );
    assert.match(background, /gradient/, `the sideways picker's ✕ sits on a round button`);
  }
  if (fixture === 'declined') {
    const card = page.getByTestId('seat-declined-notice');
    await card.getByText('Maija can’t come right now', { exact: true }).waitFor();
    await card.getByText('The seat is open again', { exact: true }).waitFor();
    assert.match(await page.getByTestId('new-table-seat-south').innerText(), /Waiting…/);
    await card.getByRole('button', { name: 'Invite someone else', exact: true }).click();
    await page.getByTestId('friend-picker').waitFor();
    assert.match(await page.getByTestId('seat-picker-container').innerText(), /Partner/);
    await card.waitFor({ state: 'detached' });
  }
  assert.equal(await page.getByTestId('create-room-window').count(), 0);
  assert.equal(
    await page.getByRole('button', { name: /^(Manage |Move to |Lock joins|Unlock joins)/ }).count(),
    0
  );
}

// The Status-Profile board's words, in its order, and nothing in the hero clipped.
async function assertLegendProfile(page, viewport) {
  const expected = [
    ['profile-title', 'Legend ★4'],
    ['profile-since', 'Level 100 · Pidro player since 2011'],
  ];
  for (const [id, text] of expected)
    assert.equal((await page.getByTestId(id).innerText()).trim(), text, id);
  assert.equal(
    await page.getByTestId('profile-friends-cell').getAttribute('aria-label'),
    'Friends, 18, 2 online'
  );
  const record = page.getByTestId('profile-record');
  await record.getByLabel('Games played: 40,612', { exact: true }).waitFor();
  await record.getByLabel('Win rate: 55%', { exact: true }).waitFor();
  const xp = page.getByTestId('profile-xp');
  await xp.getByText('Next: Legend ★5', { exact: true }).waitFor();
  await xp.getByText('133,873 XP to go', { exact: true }).waitFor();
  const medals = page.getByTestId('profile-medals');
  assert.equal(
    (await page.getByTestId('profile-medals-all').innerText()).trim(),
    'All 14 ›',
    'All N counts every medal'
  );
  const labels = await medals
    .locator('[aria-label]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute('aria-label'))
        .filter((label) => label !== 'All 14 medals')
    );
  assert.deepEqual(labels, [
    'Homerun',
    'Win Streak',
    'Partnership',
    'Full House',
    'Unstoppable, not earned yet',
  ]);
  const classic = page.getByTestId('profile-classic-row');
  await classic
    .getByText(`Old Pidro, 2011 to ${new Date().getFullYear()}`, { exact: true })
    .waitFor();
  await classic
    .getByText('Bengt64 · level 61 there · 38,536 games, counted in your record above', {
      exact: true,
    })
    .waitFor();
  for (const id of ['profile-avatar-button', 'profile-classic-chip', 'profile-friends-cell'])
    assertInsideViewport(id, await page.getByTestId(id).boundingBox(), viewport);
  await assertMinimumTouchTargets(page, 'profile-legend', viewport);
  // Blocked players stays one tap away, inside the Account row.
  await page.getByTestId('profile-blocked-link').click();
  await page.waitForURL((url) => url.pathname.endsWith('/blocked-players'));
}

async function assertHomeProfile(page, testCase, viewport) {
  const name = testCase.name;
  if (name === 'profile-friends-guest') {
    await page
      .getByTestId('auth-sheet')
      .getByRole('button', { name: 'Not now', exact: true })
      .click();
    await page.waitForURL((url) => url.pathname.endsWith('/profile'));
    await page.getByTestId('profile-friends-cell').waitFor();
    assert.equal(await page.getByTestId('tab-pill').count(), 0);
  }
  if (name === 'home-waiting' || name === 'home-waiting-guest') {
    const count = name.endsWith('-guest') ? '2' : '3';
    if (name.endsWith('-guest')) {
      assert.equal(await page.getByTestId('home-waiting-count').innerText(), count);
      assertInsideViewport(
        name,
        await page.getByTestId('home-waiting-count').boundingBox(),
        viewport
      );
      assert.equal(await page.getByTestId('tab-pill').count(), 0);
    } else {
      // PID-347: the Friends tab carries the count; the face on Home no longer does.
      assert.equal(await page.getByTestId('home-waiting-count').count(), 0);
      assert.equal(await page.getByTestId('friends-invitation-count').innerText(), count);
    }
  }
  if (name === 'home' || name === 'home-guest')
    assert.equal(await page.getByTestId('home-waiting-count').count(), 0);
  if (name === 'profile-friends' || name === 'profile-friends-zero') {
    // PID-339: friends are the third number in the stat strip; three of the six are on.
    const row = page.getByTestId('profile-friends-cell');
    assert.equal(
      await row.getAttribute('aria-label'),
      name.endsWith('-zero') ? 'Friends, 0' : 'Friends, 6, 3 online'
    );
    assert.equal(await page.getByRole('link', { name: 'Blocked players', exact: true }).count(), 1);
    assertInsideViewport(name, await row.boundingBox(), viewport);
    await row.click();
    await page.getByTestId('friends-profile-back').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('from'), 'profile');
    await page.getByTestId('friends-profile-back').click();
    await page.waitForURL((url) => url.pathname.endsWith('/profile'));
    await page.getByTestId('profile-friends-cell').waitFor();
  }
  if (name === 'profile-legend') await assertLegendProfile(page, viewport);
  if (name === 'friends-from-profile') {
    const back = page.getByTestId('friends-profile-back');
    assertInsideViewport(name, await back.boundingBox(), viewport);
    await page
      .getByTestId('tab-pill')
      .getByRole('button', { name: 'Friends', exact: true })
      .click();
    await back.waitFor({ state: 'detached' });
    await page.goto(new URL(testCase.path, baseUrl).href);
    await back.waitFor();
    await back.click();
    await page.waitForURL((url) => url.pathname.endsWith('/profile'));
    await page
      .getByTestId('tab-pill')
      .getByRole('button', { name: 'Friends', exact: true })
      .click();
    await page.waitForURL((url) => url.pathname.endsWith('/friends'));
    assert.equal(await page.getByTestId('friends-profile-back').count(), 0);
  }
  if (name === 'friends-list')
    assert.equal(await page.getByTestId('friends-profile-back').count(), 0);
}

async function assertRuleInteractions(page, testCase, viewport, screenshotDir) {
  if (testCase.rulesSelector) {
    const other = testCase.ruleSet === 'finnish' ? 'louisiana' : 'finnish';
    const button = page
      .getByTestId(testCase.rulesSelector)
      .getByRole('button', { name: new RegExp(ruleLabels[other]) });
    await button.click();
    assert.equal(await button.getAttribute('aria-selected'), 'true');
  }
  const waiting =
    testCase.name === 'table-waiting' ||
    testCase.name === 'table-louisiana-waiting' ||
    testCase.name === 'table-louisiana-waiting-explainer';
  const playing =
    testCase.name === 'table-finnish' ||
    testCase.name === 'table-louisiana' ||
    testCase.name === 'table-louisiana-explainer';
  if (!waiting && !playing) return;
  if (testCase.rulesExplainer) {
    await page.getByTestId('rules-done').click();
    await page.getByTestId(testCase.rulesBadge).waitFor();
    assert.ok(
      (waiting
        ? await page.getByTestId(testCase.rulesBadge).innerText()
        : await page.getByTestId(testCase.rulesBadge).getAttribute('aria-label')
      ).includes(ruleLabels[testCase.ruleSet])
    );
  }
  if (waiting) await page.getByTestId('waiting-rules-menu').click();
  else {
    await page.getByRole('button', { name: 'Table settings', exact: true }).click();
    await page.getByTestId('table-rules-menu').waitFor();
    await waitForScreenshotReady(page);
    await page.screenshot({ path: resolve(screenshotDir, `${testCase.name}-settings.png`) });
    await page.getByTestId('table-rules-menu').click();
  }
  await assertRulesExplainer(page, testCase.ruleSet ?? 'finnish');
  await assertMinimumTouchTargets(page, `${testCase.name}-rules`, viewport);
  await page.screenshot({ path: resolve(screenshotDir, `${testCase.name}-rules-reopened.png`) });
  await page.getByTestId('rules-done').click();
  await page.getByTestId('rules-explainer').waitFor({ state: 'hidden' });
}

async function assertPasswordReveal(page, password, name, viewport) {
  const passwordValue = 'correct horse battery staple';
  await password.fill(passwordValue);
  await page.getByRole('button', { name: 'Show password' }).click();
  if ((await password.evaluate((input) => input.type)) !== 'text') {
    throw new Error(`${name} password was not revealed in ${viewport.name}`);
  }
  if ((await password.inputValue()) !== passwordValue) {
    throw new Error(`${name} password changed while being revealed in ${viewport.name}`);
  }
  await page.getByRole('button', { name: 'Hide password' }).click();
  if ((await password.evaluate((input) => input.type)) !== 'password') {
    throw new Error(`${name} password was not hidden again in ${viewport.name}`);
  }
  if ((await password.inputValue()) !== passwordValue) {
    throw new Error(`${name} password changed while being hidden in ${viewport.name}`);
  }
  return passwordValue;
}

// Enter twice on the last field must send exactly one request, with the
// payload the server expects, and land on Home.
async function assertSingleSubmit(page, submitField, endpoint, expectedPayload, name, viewport) {
  let requestCount = 0;
  let releaseResponse;
  const responseGate = new Promise((resolveGate) => {
    releaseResponse = resolveGate;
  });
  await page.route(`**${endpoint}`, async (route) => {
    requestCount += 1;
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          token: 'ui-auth-submit-token',
          user: {
            id: 'ui-auth-submit-user',
            username: 'Player',
            email: name === 'register' ? 'player@example.com' : null,
            age_band: '18_plus',
            terms_version: '1',
          },
        },
      }),
    });
  });
  const requestPromise = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith(endpoint)
  );
  await submitField.evaluate((input) => {
    const enter = () =>
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      });
    input.dispatchEvent(enter());
    input.dispatchEvent(enter());
  });
  const request = await requestPromise;
  await page.waitForTimeout(100);
  releaseResponse();
  if (requestCount !== 1) {
    throw new Error(
      `${name} submitted ${requestCount} auth requests while loading in ${viewport.name}`
    );
  }
  const actualPayload = request.postDataJSON();
  if (JSON.stringify(actualPayload) !== JSON.stringify(expectedPayload)) {
    throw new Error(
      `${name} submitted an unexpected auth payload in ${viewport.name}: ${JSON.stringify(actualPayload)}`
    );
  }
  await page.waitForURL((url) => url.pathname.endsWith('/home'), { timeout: 10_000 });
}

async function assertAuthFormInteractions(page, name, viewport) {
  if (name === 'login') {
    const identifier = page.getByLabel('Email or username', { exact: true });
    const password = page.getByLabel('Password', { exact: true });
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByText('Enter your email or username.', { exact: true }).waitFor();
    await page.getByText('Enter your password.', { exact: true }).waitFor();
    await assertFocused(identifier, `login validation did not focus the email in ${viewport.name}`);

    await identifier.fill('Player');
    if ((await page.getByText('Enter your email or username.', { exact: true }).count()) !== 0) {
      throw new Error(`login email error did not clear after editing in ${viewport.name}`);
    }
    await identifier.press('Enter');
    await assertFocused(password, `login Next key did not focus password in ${viewport.name}`);

    const passwordValue = await assertPasswordReveal(page, password, name, viewport);
    await assertSingleSubmit(
      page,
      password,
      '/api/v1/auth/login',
      { username: 'Player', password: passwordValue, age_band: '18_plus', terms_version: '1' },
      name,
      viewport
    );
    return;
  }

  if (name !== 'register') return;

  // Step 1: the email decides between signing in and starting an account.
  const email = page.getByLabel('Email', { exact: true });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByText('Enter your email address.', { exact: true }).waitFor();
  await assertFocused(email, `register validation did not focus the email in ${viewport.name}`);
  await email.fill('player');
  if ((await page.getByText('Enter your email address.', { exact: true }).count()) !== 0) {
    throw new Error(`register email error did not clear after editing in ${viewport.name}`);
  }
  await email.press('Enter');
  await page.getByText('Check that email address.', { exact: true }).waitFor();

  await email.fill('player@example.com');
  await email.press('Enter');

  // Step 2: the password. Nothing is looked up; the server is only asked
  // when the account is made.
  await page
    .getByText('This starts a free Pidro account for player@example.com.', { exact: true })
    .waitFor();
  const password = page.getByLabel('Password', { exact: true });
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByText('Use 8 characters or more.', { exact: true }).waitFor();
  const passwordValue = await assertPasswordReveal(page, password, name, viewport);
  if ((await page.getByLabel('Confirm password').count()) !== 0) {
    throw new Error(`register still asks users to re-enter their password in ${viewport.name}`);
  }
  await password.press('Enter');

  // Step 3: the public name, then one request creates the account.
  const publicName = page.getByLabel('Public name', { exact: true });
  await publicName.waitFor();
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).click();
  await page.getByText('Enter the name other players will see.', { exact: true }).waitFor();
  await publicName.fill('Player');
  await assertSingleSubmit(
    page,
    publicName,
    '/api/v1/auth/register',
    {
      user: { username: 'Player', email: 'player@example.com', password: passwordValue },
      age_band: '18_plus',
      terms_version: '1',
    },
    name,
    viewport
  );
}

async function assertWelcomeGuestInteractions(page, name, viewport) {
  if (name !== 'welcome-guest') return;

  const requestBodies = [];
  await page.route('**/api/v1/auth/guest', async (route) => {
    requestBodies.push(route.request().postDataJSON());
    if (requestBodies.length > 1) {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            token: 'ui-guest-token',
            user: {
              id: 'ui-guest-user',
              username: 'guest_7KQ4M2XB',
              display_name: 'Amber Fox',
              email: null,
              guest: true,
              age_band: '18_plus',
              terms_version: '1',
            },
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({
        error_code: 'rate_limited',
        error_params: { retry_after: 30 },
        errors: [{ detail: 'Too many attempts. Try again soon.' }],
      }),
    });
  });
  const roomBodies = [];
  await page.route('**/api/v1/rooms', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    roomBodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ data: { code: 'SOLO1' } }),
    });
  });

  const submit = page.getByRole('button', {
    name: 'Quick game. You and three bots. No sign-up.',
    exact: true,
  });
  await submit.click();
  await page.getByText('Too many requests. Try again in 30 seconds.', { exact: true }).waitFor();
  assert.equal(
    await page.getByText('Too many attempts. Try again soon.', { exact: true }).count(),
    0
  );
  assert.equal('display_name' in requestBodies[0], false);
  assert.match(requestBodies[0].creation_token, /^[0-9a-f-]{36}$/i);
  assert.equal('invite_code' in requestBodies[0], false);
  assert.equal(requestBodies[0].age_band, '18_plus');
  assert.equal(requestBodies[0].terms_version, '1');

  await submit.click();
  await page.waitForURL((url) => url.pathname.endsWith('/game/SOLO1'), { timeout: 10_000 });
  assert.equal(requestBodies[1].creation_token, requestBodies[0].creation_token);
  assert.equal('display_name' in requestBodies[1], false);
  assert.equal(roomBodies.length, 1);
  assert.deepEqual(roomBodies[0].seats, { seat_2: 'ai', seat_3: 'ai', seat_4: 'ai' });
}

async function assertHomeGuestInteractions(page, name) {
  if (name !== 'home-guest') return;
  if ((await page.getByText('League', { exact: true }).count()) !== 0) {
    throw new Error('guest Home must not render the account tab pill');
  }

  await page
    .getByRole('button', {
      name: 'Play online. Real players. Needs a free account.',
      exact: true,
    })
    .click();
  const joinCode = page.getByRole('link', { name: 'Have a table code?', exact: true });
  await joinCode.waitFor();
  await joinCode.click();
  await page.waitForURL((url) => url.pathname.endsWith('/join-code'));
}

// The profile's cards wait for its request, so the account row never moves under a finger:
// it is not there before the answer. In Settings, Sign out and Delete account stay put.
async function assertAccountButtonsStayPut(page, name, answerProfile) {
  if (name === 'profile' || name === 'profile-guest') {
    const row = page.getByRole('button', { name: 'Account and sign-in', exact: true });
    await page
      .getByRole('button', {
        name: name === 'profile-guest' ? 'Your badges' : 'Your photo and ring',
        exact: true,
      })
      .waitFor();
    await page.waitForTimeout(150);
    assert.equal(await row.count(), 0, `${name}: the account row showed before the profile`);
    answerProfile();
    await row.waitFor();
    return;
  }
  if (name !== 'settings') return answerProfile();
  const buttons = ['Sign out', 'Delete account'].map((label) =>
    page.getByRole('button', { name: label, exact: true })
  );
  await buttons[1].waitFor();
  // Measure the profile response, not the first web-font layout settling.
  await waitForScreenshotReady(page);
  const boxes = () => Promise.all(buttons.map((button) => button.boundingBox()));
  const before = await boxes();
  answerProfile();
  await page.waitForTimeout(300);
  assert.deepEqual(await boxes(), before, `${name}: the profile answer moved the account buttons`);
}

async function assertDeleteAccountConfirmation(page, name, screenshotDir) {
  if (name !== 'profile' && name !== 'profile-guest') return;
  const classic = name === 'profile';
  // Delete account lives in Settings, one row away from the profile.
  // The row's title: Blocked players is a link of its own inside the row (PID-339).
  await page
    .getByRole('button', { name: 'Account and sign-in', exact: true })
    .getByText('Account and sign-in', { exact: true })
    .click();
  await page.waitForURL((url) => url.pathname.endsWith('/settings'));
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  await page.getByText('Delete your account?', { exact: true }).waitFor();
  const classicSentence = page.getByText(/Your old Pidro app keeps your account/);
  if (classic) await classicSentence.waitFor();
  else assert.equal(await classicSentence.count(), 0, 'the Classic sentence shows without Classic');
  await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(screenshotDir, `${name}-delete-confirm.png`) });
  if (!classic) return;
  // A refused deletion keeps the player signed in, says why and gives the action back.
  let deletes = 0;
  let refuse;
  await page.route('**/api/v1/auth/me', async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    deletes += 1;
    await new Promise((release) => (refuse = release));
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ errors: [{ detail: 'Deleting accounts is paused.' }] }),
    });
  });
  // Both taps land before the app re-renders, as a fast double tap can on a phone.
  await page
    .getByRole('button', { name: 'Delete account', exact: true })
    .last()
    .evaluate((button) => {
      button.click();
      button.click();
    });
  await page.waitForTimeout(400);
  assert.equal(deletes, 1, 'a double tap on Delete account sent more than one request');
  refuse();
  await page.getByText('Could not delete your account. Try again.', { exact: true }).waitFor();
  assert.equal(await page.getByText('Deleting accounts is paused.', { exact: true }).count(), 0);
  assert.ok(new URL(page.url()).pathname.endsWith('/settings'), 'a failed deletion left Settings');
  const action = page.getByRole('button', { name: 'Delete account', exact: true });
  assert.equal(await action.count(), 1, 'the confirmation stayed open after a failed deletion');
  assert.ok(await action.isEnabled(), 'Delete account stayed busy after a failed deletion');
  // Leaving while the deletion runs says so, not that a photo or bio is saving.
  await action.click();
  await page.getByRole('button', { name: 'Delete account', exact: true }).last().click();
  await page.getByRole('button', { name: 'League', exact: true }).click();
  await page.getByText('Your account is being deleted.', { exact: true }).waitFor();
  assert.equal(await page.getByText(/photo or bio/).count(), 0, 'deleting waits on a photo or bio');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  refuse();
  await page.getByText('Could not delete your account. Try again.', { exact: true }).waitFor();
  assert.equal(await page.getByText('Deleting accounts is paused.', { exact: true }).count(), 0);
}

async function assertAuthSheetKeepsTyping(page, name) {
  if (name !== 'auth-sheet') return;
  await page.getByRole('button', { name: 'Friends', exact: true }).click();
  // Hold the slide-in, type, then let it end: onShow fired there and wiped the form.
  const sheet = page.getByTestId('auth-sheet');
  const held = await sheet.evaluate((node) => {
    const slideIn = document.getAnimations().filter((a) => a.effect?.target?.contains(node));
    slideIn.forEach((a) => a.pause());
    return slideIn.length;
  });
  assert.ok(held > 0, 'auth sheet had slid in before it could be held');
  const email = page.getByLabel('Email', { exact: true });
  await email.fill('early@example.com');
  await sheet.evaluate(async (node) => {
    const slideIn = document.getAnimations().filter((a) => a.effect?.target?.contains(node));
    slideIn.forEach((a) => a.play());
    await Promise.all(slideIn.map((a) => a.finished));
    await new Promise((settled) => requestAnimationFrame(() => requestAnimationFrame(settled)));
  });
  assert.equal(await email.inputValue(), 'early@example.com', 'auth sheet wiped the typed email');
}

async function assertWelcomeSettingsInteractions(page, name) {
  if (name !== 'welcome') return;
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForURL((url) => url.pathname.endsWith('/device-settings'));
  await page.getByTestId('settings-screen').waitFor();
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await page.waitForURL((url) => url.pathname.endsWith('/welcome'));
}

async function assertBiddingRevealSequence(page, viewport) {
  const biddingWindow = page.getByTestId('bidding-window').first();

  // The bidding controls must not race ahead of the deal animation. A player
  // should see and be able to read the complete hand before being asked to act.
  await page.waitForTimeout(250);
  if (await biddingWindow.isVisible()) {
    throw new Error(`bidding controls appeared before the hand in ${viewport.name}`);
  }

  await page.getByTestId('rendered-hand-card-count-6').first().waitFor({ state: 'attached' });
  await page.waitForTimeout(350);
  if (await biddingWindow.isVisible()) {
    throw new Error(
      `bidding controls appeared while the hand was still dealing in ${viewport.name}`
    );
  }

  await biddingWindow.waitFor({ state: 'visible', timeout: 20_000 });
}

async function assertPlayedCardPersistence(page, viewport) {
  const fourCards = page.getByTestId('rendered-played-card-count-4').first();
  await fourCards.waitFor({ state: 'attached', timeout: 20_000 });

  // The fake server promotes the current trick into completed history after
  // 800ms. The same four sprites must still be present after that transition.
  await page.waitForTimeout(1_300);
  if ((await fourCards.count()) !== 1) {
    throw new Error(`completed trick disappeared from the table in ${viewport.name}`);
  }
}

async function assertPlayMotion(page, position, viewport) {
  await page.getByTestId('rendered-hand-card-count-6').waitFor({ state: 'attached' });
  await page.waitForTimeout(1500);
  const read = () =>
    page.getByTestId('play-presentation').getAttribute('aria-label').then(JSON.parse);
  const before = await read();
  const index = position === 'right' ? 5 : position === 'left' ? 0 : 3;
  const target = before.hand[index];
  // Observe on the browser clock before tapping. Locator polling can notice
  // the fourth card almost a second late; sleeping from there misses the hold.
  await page.evaluate(() => {
    const frames = [];
    const observer = new MutationObserver(() => {
      const fixture = JSON.parse(
        document.querySelector('[data-testid="play-fixture"]').getAttribute('aria-label')
      );
      const { lit } = JSON.parse(
        document.querySelector('[data-testid="play-presentation"]').getAttribute('aria-label')
      );
      frames.push({ time: performance.now(), lit, ...fixture });
      if (fixture.completed && lit) {
        window.__pidroPlayHold = frames;
        observer.disconnect();
      }
    });
    observer.observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label'],
    });
  });
  // Hit the exposed left edge, not the neighbour overlapping the card's centre.
  await page.mouse.click(target.x - target.w / 2 + 10, target.y);
  await page.getByTestId('rendered-hand-card-count-5').waitFor({ state: 'attached', timeout: 500 });
  assert.equal(
    JSON.parse(await page.getByTestId('play-fixture').getAttribute('aria-label')).hand,
    6,
    'the picture must move before the delayed server answer'
  );
  assert.equal((await read()).sprites[target.slot], target.key, 'the tapped sprite was replaced');
  await page.waitForTimeout(950);
  assert.ok(
    (await read()).sprites[target.slot].endsWith(target.key),
    'confirmation replaced the sprite slot'
  );
  await page.waitForFunction(() => window.__pidroPlayHold, null, { timeout: 10_000 });
  const frames = await page.evaluate(() => window.__pidroPlayHold);
  for (const seat of ['north', 'east']) {
    const received = frames.find((frame) => frame.turn === seat && !frame.completed);
    assert.ok(received, `missing ${seat} turn snapshot`);
    assert.ok(
      frames
        .filter((frame) => frame.lit === seat && !frame.completed)
        .every((frame) => frame.time >= received.time + 300),
      `${seat} lit ahead of the preceding card's landing`
    );
  }
  const hold = frames.filter((frame) => frame.completed);
  assert.equal(hold[0].lit, null, 'the next turn lit before the fourth card landed');
  assert.ok(
    hold.slice(0, -1).every(({ lit }) => lit === null),
    'a seat flashed during the hold'
  );
  const heldMs = hold.at(-1).time - hold[0].time;
  assert.ok(heldMs >= 1450, `the 1500ms trick hold lasted only ${heldMs.toFixed(0)}ms`);
  console.log(`play hold ${position}: ${heldMs.toFixed(0)}ms, no intervening seat light`);
  assert.equal(hold.at(-1).lit, 'south', 'the server-selected leader did not light after the hold');
  // The hand's tricks stay on every table (PID-308).
  assert.equal(await page.getByTestId('rendered-played-card-count-4').count(), 1);
}

/**
 * With no trick pause (Classic's 2 s beat, PID-331) the fourth card still lands,
 * and the finished trick lies still and whole for longer than a bot's beat.
 */
async function assertTrickStays(page) {
  await page.getByTestId('rendered-hand-card-count-6').waitFor({ state: 'attached' });
  await page.waitForTimeout(1500);
  const before = JSON.parse(await page.getByTestId('play-presentation').getAttribute('aria-label'));
  const target = before.hand[3];
  await page.evaluate(() => {
    const frames = [];
    let completedAt;
    const sample = () => {
      const { completed } = JSON.parse(
        document.querySelector('[data-testid="play-fixture"]').getAttribute('aria-label')
      );
      const at = performance.now();
      if (completed && completedAt === undefined) completedAt = at;
      if (completedAt !== undefined && at - completedAt >= 500)
        frames.push({ at, sprites: window.__pidroCardMotion().filter((s) => s.kind === 'played') });
      if (completedAt !== undefined && at - completedAt >= 3000) window.__pidroTrickFrames = frames;
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.mouse.click(target.x - target.w / 2 + 10, target.y);
  await page.waitForFunction(() => window.__pidroTrickFrames, null, { timeout: 15_000 });
  const frames = await page.evaluate(() => window.__pidroTrickFrames);
  const settled = frames[0].sprites;
  assert.equal(settled.length, 4, 'the finished trick lost a card');
  for (const frame of frames) {
    assert.equal(frame.sprites.length, 4, 'a card of the finished trick vanished');
    for (const s of frame.sprites) {
      const first = settled.find((c) => c.key === s.key);
      assert.ok(first, `${s.key} replaced a card of the finished trick`);
      assert.equal(s.opacity, 1, `${s.key} faded`);
      assert.ok(Math.hypot(s.x - first.x, s.y - first.y) < 0.5, `${s.key} moved`);
    }
  }
  const lit = JSON.parse(
    await page.getByTestId('play-presentation').getAttribute('aria-label')
  ).lit;
  assert.equal(lit, 'south', 'the server-selected leader is not lit');
  console.log(
    `trick stays: 4 cards still and opaque for ${(frames.at(-1).at - frames[0].at + 500).toFixed(0)}ms after completion`
  );
}

async function assertCardCollection(page, winner, reduced, viewport) {
  await page.getByTestId('rendered-hand-card-count-6').waitFor({ state: 'attached' });
  await page.waitForTimeout(1500);
  const before = JSON.parse(await page.getByTestId('play-presentation').getAttribute('aria-label'));
  const target = before.hand[3];
  await page.evaluate((sweepEnabled) => {
    const frames = [];
    let completedAt;
    window.__pidroMotionFrames = frames;
    window.__pidroMotionDone = false;
    const sample = () => {
      const fixture = JSON.parse(
        document.querySelector('[data-testid="play-fixture"]').getAttribute('aria-label')
      );
      const sprites = window.__pidroCardMotion();
      const at = performance.now();
      if (fixture.completed && completedAt === undefined) completedAt = at;
      frames.push({ at, completed: fixture.completed, sprites });
      window.__pidroMotionDone = sweepEnabled
        ? sprites.filter((s) => s.collection === 1).length === 4
        : completedAt !== undefined && at - completedAt >= 2000;
      if (!window.__pidroMotionDone) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, TRICK_SWEEP_ENABLED);
  await page.mouse.click(target.x - target.w / 2 + 10, target.y);
  await page.waitForFunction(() => window.__pidroMotionDone);
  const frames = await page.evaluate(() => window.__pidroMotionFrames);
  const completed = frames.find((f) => f.completed);
  if (TRICK_SWEEP_ENABLED) {
    const gathering = frames.find((f) => f.sprites.some((s) => s.collection > 0));
    assert.ok(gathering.at - completed.at >= 1450, 'collection cut into the 1500ms hold');
  } else {
    assert.ok(
      frames.every((f) => f.sprites.every((s) => s.collection === 0 && !s.collectTo)),
      'disabled sweep still collected a card'
    );
  }
  assert.equal(frames.at(-1).sprites.filter((s) => s.kind === 'hand').length, 5);
  const played = frames.at(-1).sprites.filter((s) => s.kind === 'played');
  assert.equal(played.length, 4, 'collection must retain the server history slots');
  assert.ok(
    played.every((s) => s.opacity === 1),
    'completed trick faded before the server removed its history'
  );
  const center = await page.getByTestId('table-trick-center').boundingBox();
  const remaining = frames.at(-1).sprites.filter((s) => s.kind === 'hand');
  const handCenter = before.hand.reduce((sum, s) => sum + s.x, 0) / before.hand.length;
  assert.ok(
    Math.abs(remaining.reduce((sum, s) => sum + s.x, 0) / 5 - handCenter) < 1,
    'the hand moved its centre while closing the gap'
  );
  for (const card of remaining) {
    const start = before.hand.find((s) => s.key === card.key).x;
    const path = frames.flatMap((f) =>
      f.sprites.filter((s) => s.kind === 'hand' && s.key === card.key)
    );
    assert.ok(
      path.every((s) => s.x >= Math.min(start, card.x) - 1 && s.x <= Math.max(start, card.x) + 1),
      'hand closure bounced past its slot'
    );
    if (!reduced)
      assert.ok(
        path.some((s) => Math.abs(s.x - start) > 1 && Math.abs(s.x - card.x) > 1),
        'hand closure jumped instead of sliding'
      );
  }
  for (const card of played) {
    if (!TRICK_SWEEP_ENABLED) continue;
    const { x, y } = card.collectTo;
    assert.ok(
      winner === 'north'
        ? y < center.y
        : winner === 'south'
          ? y > center.y
          : winner === 'east'
            ? x > center.x
            : x < center.x,
      `sweep went away from ${winner}`
    );
  }
  const own = frames.flatMap((f) =>
    f.sprites.filter((s) => s.kind === 'played' && s.key.endsWith(target.key))
  );
  assert.ok(
    own.every((s) => s.flight >= 0 && s.y <= target.y + 1),
    'the played card dipped below its hand position before lifting'
  );
  if (reduced) {
    assert.ok(
      own.every((s) => s.flight === 1),
      'reduced motion flew the played card'
    );
    assert.ok(
      frames.every((f) => f.sprites.every((s) => s.collection === 0 || s.collection === 1)),
      'reduced motion swept the trick'
    );
  } else {
    assert.ok(
      own.some((s) => s.scale > target.scale * 1.025),
      'own card never lifted'
    );
    assert.ok(
      own.some((s) => s.flight > 1),
      'landing never settled from its overshoot'
    );
    if (TRICK_SWEEP_ENABLED)
      assert.ok(
        frames.some((f) => f.sprites.some((s) => s.collection > 0 && s.collection < 1)),
        'trick snapped instead of gathering and sweeping'
      );
  }
  console.log(
    `motion ${winner}${reduced ? ' reduced' : ''}: lift/settle, ${TRICK_SWEEP_ENABLED ? 'held winner-directed sweep' : 'visible history without collection'} passed`
  );
}

/** Samples the cut as the dealer-late fixture plays it out, up to the deal. */
async function assertDealerCatchUp(page, viewport) {
  const timeline = await page.evaluate(async () => {
    const samples = [];
    for (let i = 0; i < 600; i++) {
      const clock = globalThis.__pidroDealerClock;
      const motion = globalThis.__pidroCardMotion?.() ?? [];
      if (clock) {
        samples.push({
          t: Date.now() - clock.cutAt,
          lit: motion.some(
            (card) =>
              card.kind === 'cut' && card.opacity > 0.5 && card.renderedScale > card.scale * 1.05
          ),
          dealtAt: clock.dealtAt && clock.dealtAt - clock.cutAt,
        });
        if (clock.dealtAt) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return samples;
  });
  const end = timeline.at(-1);
  assert.ok(end?.dealtAt, `the dealer-late fixture ran to its deal in ${viewport.name}`);
  const litAt = timeline.find((sample) => sample.lit)?.t;
  assert.ok(
    litAt != null && end.dealtAt - litAt >= 300,
    `the cut's winner is lit at least 300 ms before the server deals in ${viewport.name} (lit at ${litAt}, dealt at ${end.dealtAt})`
  );
}

async function assertDealerCutCards(page, viewport) {
  const fourCards = page.getByTestId('rendered-cut-card-count-4').first();
  await fourCards.waitFor({ state: 'attached', timeout: 20_000 });

  if ((await fourCards.count()) !== 1) {
    throw new Error(`dealer selection did not show all four cut cards in ${viewport.name}`);
  }
}

async function assertDealerSecondDeal(page, testCase, viewport) {
  if (testCase.verifyDealerSelection) {
    await page.getByText('Swipe to review all 12 cards', { exact: false }).waitFor();
    await page.getByTestId('rendered-hand-card-count-0').waitFor({ state: 'attached' });
    const keepButton = page.getByRole('button', { name: 'Keep selected cards' });
    if ((await keepButton.count()) !== 1 || !(await keepButton.isDisabled())) {
      throw new Error(`dealer hand selector is incomplete in ${viewport.name}`);
    }

    for (const label of [
      '8 of Clubs',
      'Ace of Spades, worth 1 point',
      '3 of Hearts',
      'Jack of Diamonds',
      '10 of Hearts',
      '2 of Spades, worth 1 point',
    ]) {
      const card = page.getByRole('button', { name: label, exact: true });
      await card.scrollIntoViewIfNeeded();
      await card.click();
    }
    await page.getByText('6 of 6 selected', { exact: false }).waitFor();
    if (await keepButton.isDisabled()) {
      throw new Error(`dealer cannot confirm six selected cards in ${viewport.name}`);
    }
  }

  // Everyone else watches the dealer take the pack on the table: no panel
  // over the felt, the dealer's hand holds the pool.
  if (testCase.verifyDealerOnTable) {
    const panels = ['dealer-second-deal-status', 'automatic-dealer-rob', 'hand-selection-window'];
    const said = await Promise.all(panels.map((id) => page.getByTestId(id).count()));
    if (said.some((count) => count !== 0)) {
      throw new Error(`the dealer's pick must play out on the table in ${viewport.name}`);
    }
  }
}

// Each seat says its bid, aloud and on screen. Your tight seat has no name,
// so it shows the short form under its avatar, inside the seat's column,
// which ends where your cards begin.
const TALK_WORDS = {
  en: [
    'Nice trick!',
    'Well played',
    'Good bid',
    'Sorry partner',
    'Oops',
    'Thanks!',
    'Good luck',
    'Good game',
    'Hello!',
  ],
  sv: [
    'Snyggt stick!',
    'Bra spelat',
    'Bra bud',
    'Förlåt, partner',
    'Hoppsan',
    'Tack!',
    'Lycka till',
    'Bra spel',
    'Hej!',
  ],
};
const overlaps = (a, b) =>
  a.x < b.x + b.width - 1 &&
  b.x < a.x + a.width - 1 &&
  a.y < b.y + b.height - 1 &&
  b.y < a.y + a.height - 1;

const OFFER_WORDS = {
  offer: { en: 'Nice trick!', sv: 'Snyggt stick!' },
  'offer-turn': { en: 'Nice trick!' },
  'offer-tap': { en: 'Nice trick!' },
  'offer-slide': { en: 'Nice trick!' },
  reply: { en: 'Thanks!' },
  'reply-narrow': { en: 'Thanks!' },
  start: { en: 'Hello!' },
  'deal-bidding': { en: 'Hello!' },
};

/**
 * The size each upright phone's tail takes (PID-396): one line at body size,
 * one at the small size, two lines, or none (the bubble lights alone), from
 * the room left of the bubble (89pt at 390, 81 at 360×640, 74 at 360×780, 95
 * at 402) and the word as drawn. No phone here leaves too little room for
 * Thanks!; `reply-narrow` holds the room at 64pt to light the bubble alone.
 */
const TAIL_SIZE = {
  'portrait/reply': 'body',
  'portrait/offer': 'small',
  'portrait/reply-narrow': null,
  'small-portrait/reply': 'body',
  'small-portrait/offer': 'small',
  'iphone-insets-portrait/offer': 'small',
  'compact-portrait/reply': 'small',
  'compact-portrait/offer': 'two',
  'android-portrait/reply': 'small',
  'android-portrait/offer': 'two',
  'android-portrait/reply-narrow': null,
};

/**
 * What the game offers to say (PID-328): a word card beside the speech
 * button, clear of your seat (and in landscape of your hand), dimmed but kept
 * on your turn, and one tap says it and puts the button back. Upright phones
 * (PID-396) say the word in the bubble's tail: a cream face joined to the
 * bubble as one pill, the word whole, the bubble still a 52pt button; one
 * tap on the word says it and the tail folds back. Where no size fits, the
 * bubble carries the gold line alone and opens the words.
 */
async function assertTalkOffer(page, testCase, viewport, corner) {
  const word = OFFER_WORDS[testCase.talk]?.[testCase.locale];
  if (!word) return false;
  if (testCase.talk === 'deal-bidding') return assertTalkDeal(page, viewport);
  const offer = page.getByTestId('talk-offer');
  await offer.waitFor();
  await offer.getByTestId('talk-offer-line').waitFor();
  const card = offer.getByRole('button', { name: word, exact: true });
  const upright = corner && viewport.height > viewport.width;
  const tail = upright ? await assertTail(page, offer, card, testCase, viewport) : null;
  if (!upright) await card.waitFor();
  // An offer's faces are TalkCoin's plain emoji, nothing gold.
  const offered = await offer.locator('[data-testid^="talk-coin_"]').all();
  // Nice trick! brings heart and thumb; Hello and Thanks come alone.
  if (!corner && testCase.talk.includes('offer'))
    assert.ok(offered.length > 0, 'the offer holds a face');
  for (const face of offered) {
    assert.match(await face.innerText(), /^(👍|❤️|😂|😅|😮)$/u, 'an offered face is an emoji');
    assert.equal(
      await face.evaluate((node) => getComputedStyle(node).backgroundImage),
      'none',
      'an offered face is not gold'
    );
  }
  const box = await getStableBox(offer, page);
  assertInsideViewport('talk offer', box, viewport);
  const you = await getStableBox(page.getByTestId('seat-south'), page);
  // Upright, the tail reaches into the seat's name column beside the avatar
  // (PID-396): it keeps off what the seat draws, its face, turn ring and words.
  const drawn = upright
    ? await page.getByTestId('seat-south').evaluate((seat) =>
        [...seat.querySelectorAll('img, circle, *')]
          .filter(
            (node) =>
              ['IMG', 'circle'].includes(node.tagName) ||
              (node.childElementCount === 0 && node.textContent.trim())
          )
          .map((node) => {
            const { x, y, width, height } = node.getBoundingClientRect();
            return { label: node.textContent || node.tagName, x, y, width, height };
          })
          .filter(({ width, height }) => width && height)
      )
    : [you];
  for (const part of drawn)
    assert.ok(
      !overlaps(box, part),
      `the offer keeps clear of your seat: ${JSON.stringify({ box, part })}`
    );
  if (upright) await assertBubble(box, you, viewport);
  assert.equal(
    await offer.evaluate((node) => Number(getComputedStyle(node).opacity)),
    testCase.talk === 'offer-turn' ? 0.6 : 1,
    'on your turn the offer dims, and only then'
  );
  if (testCase.talk === 'offer-tap' && upright && !tail) {
    await offer.getByTestId('talk-speech').click();
    await page.getByTestId('talk-sheet-typing').getByTestId('talk-word_nice').click();
    await page.getByTestId('talk-landed').getByText(word).waitFor();
  } else if (testCase.talk === 'offer-tap' && upright) {
    // One tap says it; the tail folds back under the bubble, itself again.
    await card.click();
    await offer.waitFor({ state: 'detached' });
    await page.locator('[data-testid^="talk-tail-"]').waitFor({ state: 'detached' });
    await page.getByTestId('talk-landed').getByText(word).waitFor();
    const bubble = await getStableBox(page.getByTestId('talk-speech'), page);
    await assertBubble(bubble, await getStableBox(page.getByTestId('seat-south'), page), viewport);
  } else if (testCase.talk === 'offer-tap') {
    await card.click();
    await offer.waitFor({ state: 'detached' });
    await page.getByTestId('talk-landed').getByText(word).waitFor();
  }
  await waitForScreenshotReady(page);
  await assertMinimumTouchTargets(page, testCase.name, viewport);
  return true;
}

/** The upright tail (PID-396), its size pinned where TAIL_SIZE names one; null where none fits. */
async function assertTail(page, offer, card, testCase, viewport) {
  const speech = offer.getByTestId('talk-speech');
  await speech.waitFor();
  const tails = offer.locator('[data-testid^="talk-tail-"]');
  const size = (await tails.count())
    ? (await tails.first().getAttribute('data-testid')).replace('talk-tail-', '')
    : null;
  const key = `${viewport.name}/${testCase.talk.replace(/-(turn|tap|slide)$/, '')}`;
  if (testCase.locale === 'en' && key in TAIL_SIZE)
    assert.equal(size, TAIL_SIZE[key], `${testCase.name}: the tail's size in ${viewport.name}`);
  const bubble = await getStableBox(speech, page);
  assert.ok(bubble.width >= 52 && bubble.height >= 52, 'the bubble stays a 52pt button');
  if (!size) {
    assert.equal(await card.count(), 0, 'no word where the tail cannot fit');
    return null;
  }
  const slot = await getStableBox(tails.first(), page);
  // The tail slides out in 260ms: measure it where it rests.
  let face = await getStableBox(card, page);
  for (let was = null; was?.x !== face.x;) {
    was = face;
    await page.waitForTimeout(120);
    face = await getStableBox(card, page);
  }
  assert.ok(Math.abs(slot.x + slot.width - bubble.x) <= 1, 'the tail joins the bubble');
  assert.ok(Math.abs(slot.y - bubble.y) <= 1 && Math.abs(slot.height - bubble.height) <= 1);
  assert.ok(slot.width >= 44, 'the word is a thumb wide at least');
  assert.ok(slot.x >= 0, 'the tail stays on screen');
  // Fixtures hold it halfway out of the bubble.
  const out = testCase.talk === 'offer-slide' ? 0.5 : 1;
  assert.ok(
    Math.abs(face.x - (slot.x + slot.width * (1 - out))) <= 2,
    `the tail is ${out * 100}% out: ${JSON.stringify({ slot, face })}`
  );
  // The word whole: no ellipsis, nothing cut.
  const clipped = await card.evaluate((node) =>
    [...node.querySelectorAll('*')].some(
      (child) =>
        child.childElementCount === 0 &&
        (child.scrollWidth > child.clientWidth + 1 || child.scrollHeight > child.clientHeight + 1)
    )
  );
  assert.equal(clipped, false, `the word is whole in its ${size} tail`);
  return size;
}

/**
 * You deal and the game offers a greeting while your pack rests (PID-396):
 * landscape phones lift the word card over the pack, or, where the pack would
 * meet the bubble, stand it above the hand's right end (640 wide) or lay it
 * bottom left beside your seat (667 wide, where East's seat comes down); iPads
 * stand it above the hand's left end; upright phones keep it bottom left.
 * Nothing talk shows, the bubble included, touches the pack or a seat.
 */
async function assertTalkDeal(page, viewport) {
  const speech = page.getByTestId('talk-speech');
  await page.getByTestId('talk-offer').or(speech).first().waitFor();
  const backs = [];
  for (const image of await page.getByTestId('dealer-pack').locator('img').all()) {
    const box = await image.boundingBox();
    if (box) backs.push(box);
  }
  assert.ok(backs.length, `your pack shows in ${viewport.name}`);
  const x = Math.min(...backs.map((b) => b.x));
  const y = Math.min(...backs.map((b) => b.y));
  const pack = {
    x,
    y,
    width: Math.max(...backs.map((b) => b.x + b.width)) - x,
    height: Math.max(...backs.map((b) => b.y + b.height)) - y,
  };
  assertInsideViewport('your pack', pack, viewport);
  // Nor does it lie under a seat or its backs (PID-396: at 667×375 East's seat
  // comes down to where the pack stands at 640).
  const seats = page.locator(
    ['north', 'east', 'west']
      .flatMap((seat) => [`[data-testid="seat-${seat}"]`, `[data-testid="seat-${seat}-cards"] img`])
      .join(', ')
  );
  for (const seat of await seats.all()) {
    const box = await seat.boundingBox();
    if (box)
      assert.ok(
        !overlaps(box, pack),
        `your pack keeps off a seat: ${JSON.stringify({ box, pack })}`
      );
  }
  const said = page
    .getByTestId('talk-offer')
    .locator('[role="button"]')
    .or(page.getByTestId('talk-offer-line'));
  // Where the offer lights the bubble alone, the bubble is still talk's.
  const parts = [...(await said.all()), ...(await speech.all())];
  for (const part of parts) {
    const box = await getStableBox(part, page);
    assertInsideViewport('the offer', box, viewport);
    assert.ok(
      !overlaps(box, pack),
      `the offer keeps off your pack: ${JSON.stringify({ box, pack })}`
    );
  }
  await waitForScreenshotReady(page);
  await assertMinimumTouchTargets(page, 'table-talk-deal-bidding', viewport);
  return true;
}

/**
 * Upright phones (PID-393): the bubble sits in the bottom right corner, its
 * centre level with your avatar's. Expo web drops your seat's empty line,
 * lowering the avatar 14pt where the seat has nothing to say; a phone keeps it.
 */
async function assertBubble(box, you, viewport) {
  assert.ok(
    Math.abs(viewport.width - 12 - (box.x + box.width)) <= 1,
    `the bubble sits in the right corner: ${JSON.stringify(box)}`
  );
  const avatar = you.y + Math.min(you.height, 56) / 2;
  assert.ok(
    Math.abs(box.y + box.height / 2 - avatar) <= 15,
    `the bubble is level with your avatar: ${JSON.stringify({ box, you })}`
  );
}

const PERSON_SHEETS = { report: 'report' };

/** A sheet fits its screen without scrolling. */
async function assertTalkSheetFits(sheet, page, viewport) {
  assertInsideViewport('talk sheet', await getStableBox(sheet, page), viewport);
  assert.equal(
    await sheet.evaluate((node) =>
      [node, ...node.querySelectorAll('*')].some(
        (child) =>
          ['auto', 'scroll'].includes(getComputedStyle(child).overflowY) &&
          child.scrollHeight > child.clientHeight + 1
      )
    ),
    false,
    'the sheet needs no scrolling'
  );
}

/**
 * A face at the table (PID-329, PID-406): Report asks one question with three
 * choices, then thanks; Quiet hides what that person said, and a tap on their
 * face, then their sheet's •••, gets there.
 */
async function assertTalkPerson(page, testCase, viewport) {
  const state = testCase.talk;
  if (PERSON_SHEETS[state]) {
    const sheet = page.getByTestId(`talk-sheet-${PERSON_SHEETS[state]}`);
    await sheet.waitFor();
    await assertTalkSheetFits(sheet, page, viewport);
    for (const reason of ['rude', 'bothering', 'other'])
      await sheet.getByTestId(`talk-report-${reason}`).waitFor();
  } else if (state === 'reported') {
    // One tap on a choice reports it and says thanks.
    await page.getByTestId('talk-report-rude').click();
    await page.getByTestId('talk-sheet-reported').waitFor();
  } else if (state === 'quieted') {
    // Antti is quiet: his word neither lands nor stays as the band's line.
    await page.getByTestId('talk-landed').first().waitFor();
    assert.equal(await page.getByTestId('talk-landed').count(), 1, 'only Jocke lands');
    assert.equal(await page.getByText('Well played').count(), 0, 'Antti is not heard');
  } else if (state === 'face-tap') {
    // Your own face still opens your profile; a person's opens their sheet.
    await page.getByTestId('seat-south').click();
    await page.getByTestId('player-sheet').waitFor();
    assert.equal(await page.getByTestId('talk-sheet-person').count(), 0, 'no sheet for you');
    const profile = page.getByTestId('player-sheet');
    await profile.getByRole('button', { name: 'Close', exact: true }).last().click();
    await profile.waitFor({ state: 'detached' });
    await page.getByTestId('talk-landed').getByText('Well played').waitFor();
    // Antti's face opens his player sheet (PID-406); Quiet waits in its •••.
    await page.getByTestId('seat-west').click();
    const sheet = page.getByTestId('player-sheet');
    await sheet.getByText('Antti', { exact: true }).waitFor();
    await sheet.getByTestId('player-sheet-more').click();
    const menu = sheet.getByTestId('player-sheet-menu');
    assert.deepEqual(
      (await menu.getByRole('button').allInnerTexts()).map((text) => text.trim()),
      ['Quiet Antti’s words', 'Report Antti', 'Block Antti', 'Back'],
      'the menu, in its order'
    );
    await sheet.getByTestId('player-sheet-quiet').click();
    await sheet.waitFor({ state: 'detached' });
    // Quiet hides what Antti already said, too.
    await page
      .getByTestId('talk-landed')
      .filter({ hasText: 'Well played' })
      .first()
      .waitFor({ state: 'detached' });
  } else return false;
  await waitForScreenshotReady(page);
  await assertMinimumTouchTargets(page, testCase.name, viewport);
  return true;
}

const DRAFT = 'Nice one with that five';

/**
 * Typing (PID-318): an adult gets the box under the words, a guest the account
 * line, a 13 to 17 nothing; the box says who will not see it, Send sends and
 * closes, refused words stay with "Try other words", and your turn closes the
 * box with the words waiting in the band.
 */
async function assertTalkTyping(page, testCase, viewport, corner) {
  const state = testCase.talk;
  const sv = testCase.locale === 'sv';
  if (['type', 'guest', 'teen'].includes(state)) {
    // An adult's band opens the composer, faces and words in reach; the rest get the words.
    const sheet = page.getByTestId(`talk-sheet-${state === 'type' ? 'typing' : 'words'}`);
    await sheet.waitFor();
    await assertTalkSheetFits(sheet, page, viewport);
    const account = sheet.getByTestId('talk-account');
    assert.equal(await account.count(), state === 'guest' ? 1 : 0, 'a guest is asked to sign up');
    if (state === 'type') {
      await sheet.getByTestId('talk-word_nice').waitFor();
      await sheet.getByTestId('talk-coin_ha').waitFor();
      assert.equal(
        await sheet.locator('input').getAttribute('placeholder'),
        sv ? 'Skriv ett meddelande' : 'Type a message'
      );
    }
    if (state === 'guest') await account.getByText('Make a free account').waitFor();
    if (state === 'teen')
      assert.equal(await sheet.getByText(/type|account/i).count(), 0, 'nothing about typing');
  } else if (['typing', 'filtered', 'say', 'say-word'].includes(state)) {
    const sheet = page.getByTestId('talk-sheet-typing');
    await sheet.waitFor();
    await assertTalkSheetFits(sheet, page, viewport);
    const box = sheet.locator('input');
    assert.equal(await box.inputValue(), DRAFT, 'the draft is in the box');
    assert.equal(await box.getAttribute('maxlength'), '80', 'eighty characters');
    await sheet
      .getByTestId('talk-unread')
      .getByText(sv ? /utom Antti/ : /except Antti/)
      .waitFor();
    if (state === 'filtered') {
      await sheet.getByTestId('talk-say').click();
      await sheet.getByText('Try other words').waitFor();
      assert.equal(await box.inputValue(), DRAFT, 'refused words stay in the box');
    }
    if (state === 'say-word') {
      // A word said instead of the typed one drops the draft.
      await sheet.getByTestId('talk-word_nice').click();
      await sheet.waitFor({ state: 'detached' });
      await page.getByTestId('talk-landed').waitFor();
      assert.equal(await page.getByText(DRAFT).count(), 0, 'the unsent draft is gone');
    }
    if (state === 'say') {
      await sheet.getByTestId('talk-say').click();
      await sheet.waitFor({ state: 'detached' });
      await page.getByTestId('talk-landed').getByText(DRAFT).waitFor();
    }
  } else if (state === 'typing-turn') {
    // Your turn closed the box; the words wait in the iPad's band, or in a phone's speech button.
    assert.equal(await page.getByTestId('talk-sheet-typing').count(), 0, 'the box closed');
    if (corner) {
      const speech = page.getByTestId('talk-speech');
      await speech.waitFor();
      assert.equal(await speech.getAttribute('aria-label'), `Your turn first. ${DRAFT}`);
    } else {
      const band = page.getByTestId('talk-band').first();
      await band.getByText('Your turn first.').waitFor();
      await band.getByText(DRAFT).waitFor();
    }
  } else return false;
  await waitForScreenshotReady(page);
  await assertMinimumTouchTargets(page, testCase.name, viewport);
  return true;
}

/**
 * Table talk (PID-114). A phone's speech bubble sits in the corner (PID-393),
 * an iPad's band beside the hand; neither moves the table. A landing stays
 * clear of every seat's cards, the hand of words fits without scrolling, and
 * one tap sends and closes it.
 */
async function assertTalk(page, testCase, viewport) {
  if (!testCase.talk) return;
  // Phones keep a speech bubble in the corner; an iPad keeps the band beside the hand.
  const corner = Math.min(viewport.width, viewport.height) < 600;
  if (await assertTalkOffer(page, testCase, viewport, corner)) return;
  if (await assertTalkPerson(page, testCase, viewport)) return;
  if (await assertTalkTyping(page, testCase, viewport, corner)) return;
  // The table's own; the log's sheet holds a band.
  const opener = page.getByTestId(corner ? 'talk-speech' : 'talk-band').first();
  await opener.waitFor();
  const openerBox = await getStableBox(opener, page);
  assertInsideViewport('talk opener', openerBox, viewport);
  const you = await getStableBox(page.getByTestId('seat-south'), page);
  if (corner && viewport.height > viewport.width) await assertBubble(openerBox, you, viewport);
  assert.ok(!overlaps(openerBox, you), 'talk keeps clear of your seat');
  // Phones keep only the speech bubble in their corner; it opens the log.
  if (testCase.talk === 'line' && !corner)
    await opener.getByText(testCase.locale === 'sv' ? 'Tack!' : 'Thanks!').waitFor();
  // A dot while a line waits unread; opening the log reads it. Without one, no dot.
  assert.equal(
    await opener.getByTestId('talk-speech-dot').count(),
    corner && testCase.talk === 'unread' ? 1 : 0,
    'the bubble wears a dot only while a line waits unread'
  );
  if (testCase.talk === 'unread' && corner) {
    await opener.click();
    await page.getByTestId('talk-sheet-typing').waitFor();
    assert.equal(await page.getByTestId('talk-speech-dot').count(), 0, 'open, the dot goes');
  }
  if (testCase.talk === 'quiet' || testCase.talk === 'send')
    assert.equal(await page.getByTestId('talk-landed').count(), 0, 'nothing has landed yet');
  if (testCase.talk === 'send') {
    await opener.click();
    await page.getByTestId('talk-sheet-typing').waitFor();
    await page.getByTestId('talk-word_nice').click();
    await page.getByTestId('talk-sheet-typing').waitFor({ state: 'detached' });
  }
  if (['landed', 'coin', 'send', 'face'].includes(testCase.talk)) {
    const landed = page.getByTestId('talk-landed');
    await landed.first().waitFor();
    await page.waitForTimeout(400);
    // The backs themselves, not the columns that hold them.
    const cards = await page
      .locator('[data-testid^="seat-"][data-testid$="-cards"] img')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const { x, y, width, height } = node.getBoundingClientRect();
          return { x, y, width, height };
        })
      );
    assert.ok(cards.length > 0, 'the seats hold cards');
    for (const landing of await landed.all()) {
      const box = await getStableBox(landing.locator(':scope > *').first(), page);
      assertInsideViewport('talk landing', box, viewport);
      for (const card of cards) assert.ok(!overlaps(box, card), 'a landing never covers cards');
      // Beside its own ring, in numbers: iOS once put North's and yours ~120 pt off.
      const ring = await landing.evaluate((node) =>
        node.parentElement.getBoundingClientRect().toJSON()
      );
      const gap =
        Math.max(0, ring.x - (box.x + box.width), box.x - (ring.x + ring.width)) +
        Math.max(0, ring.y - (box.y + box.height), box.y - (ring.y + ring.height));
      assert.ok(gap <= 14, `a landing sits by its own ring: ${JSON.stringify({ box, ring })}`);
      // Faces and words are plain bubbles, nothing gold.
      assert.equal(
        await landing
          .locator(':scope > *')
          .first()
          .evaluate((node) => getComputedStyle(node).backgroundImage),
        'none',
        'a landing has no gradient'
      );
    }
    if (testCase.talk === 'send') await landed.getByText(TALK_WORDS.en[0]).waitFor();
  }
  if (testCase.talk === 'face') {
    // Plain emoji, nothing gold; the label still says the word.
    const landed = page.getByTestId('talk-landed');
    assert.equal(await landed.count(), 2, 'North and you');
    await landed.getByText('❤️').waitFor();
    await landed.getByText('😂').waitFor();
    const labels = await landed.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('aria-label'))
    );
    assert.deepEqual(
      labels.sort(),
      ['Jocke: Love it', 'You: Ha'].sort(),
      'each landing speaks its word'
    );
    // Phones keep only the speech button; an iPad's band says You 😂.
    if (!corner) {
      const band = page.getByTestId('talk-band').first();
      await band.getByText('😂').waitFor();
      assert.match(await band.getAttribute('aria-label'), /Ha/);
    }
    assert.equal(await page.getByText('Ha', { exact: true }).count(), 0, 'the face, not its word');
  }
  if (testCase.talk === 'sheet') {
    const coins = page.getByTestId('talk-sheet-words').locator('[data-testid^="talk-coin_"]');
    assert.deepEqual(
      await coins.evaluateAll((nodes) =>
        nodes.map((node) => [node.innerText.trim(), node.getAttribute('aria-label')])
      ),
      testCase.locale === 'sv'
        ? [
            ['👍', 'Bra'],
            ['❤️', 'Härligt!'],
            ['😂', 'Haha'],
            ['😅', 'Hoppsan'],
            ['😮', 'Wow'],
          ]
        : [
            ['👍', 'Good'],
            ['❤️', 'Love it'],
            ['😂', 'Ha'],
            ['😅', 'Oops'],
            ['😮', 'Wow'],
          ],
      'five plain faces, each saying its word'
    );
  }
  if (testCase.talk === 'sheet' || testCase.talk === 'log') {
    const sheet = page.getByTestId(`talk-sheet-${testCase.talk === 'sheet' ? 'words' : 'log'}`);
    await sheet.waitFor();
    assertInsideViewport('talk sheet', await getStableBox(sheet, page), viewport);
    assert.equal(
      await sheet.evaluate((node) =>
        [node, ...node.querySelectorAll('*')].some(
          (child) =>
            ['auto', 'scroll'].includes(getComputedStyle(child).overflowY) &&
            child.scrollHeight > child.clientHeight + 1
        )
      ),
      false,
      'the sheet needs no scrolling'
    );
    if (testCase.talk === 'sheet') {
      const words = sheet.locator('[data-testid^="talk-word_"]');
      assert.deepEqual(
        await words.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label'))),
        TALK_WORDS[testCase.locale]
      );
      assert.equal(await sheet.locator('[data-testid^="talk-coin_"]').count(), 5, 'five coins');
      for (const word of await words.all()) {
        const text = word.locator('[dir="auto"]').last();
        assert.equal(
          await text.evaluate((node) => node.scrollWidth > node.clientWidth + 1),
          false,
          'a word fits its card'
        );
      }
    }
  }
  await waitForScreenshotReady(page);
  await assertMinimumTouchTargets(page, testCase.name, viewport);
}

/** The bot crew sits by name, and each seat still says it is a bot. */
async function assertCrew(page, testCase) {
  for (const [seat, name] of Object.entries(testCase.crew ?? {})) {
    await page.waitForFunction(
      ([id, text]) =>
        document
          .querySelector(`[data-testid="${id}"]`)
          ?.getAttribute('aria-label')
          ?.startsWith(text),
      [`seat-${seat}`, `${name}, Bot`],
      { timeout: 10_000 }
    );
  }
}

async function assertBotVoice(page, testCase, viewport) {
  if (!testCase.botVoice) return;
  if (testCase.botCard) {
    const card = page.getByTestId('bot-profile-modal');
    const copy = page.getByTestId('bot-profile-copy');
    await copy.getByText(testCase.botCard, { exact: true }).waitFor();
    await copy
      .getByText(
        {
          sv: {
            rulebook:
              'Spelar ett ärligt spel: bjuder bara så högt som behövs, räknar trumf och stöttar sin partner.',
            search:
              'Spelar på oddsen: delar ut korten den inte ser och väljer det spel som vinner oftast, men bjuder ändå bara vad kontraktet kräver.',
          },
          en: {
            rulebook:
              'Plays the honest game: bids only as high as it needs to, counts trumps and backs up its partner.',
            search:
              'Plays the odds: deals out the cards it can’t see and takes the line that wins most often, yet still bids only what the contract needs.',
          },
        }[testCase.locale][testCase.botPlay ?? 'rulebook'],
        { exact: true }
      )
      .waitFor();
    // At a bot table (PID-408) a bot can be quieted for the game: Close and Quiet, nothing to report.
    assert.deepEqual(
      await card
        .getByRole('button')
        .evaluateAll((nodes) => nodes.map((node) => node.dataset.testid ?? '')),
      ['player-sheet-quiet', ''],
      'bots have Quiet and Close, no social actions'
    );
    for (const text of await copy.locator('[dir="auto"]').all()) {
      assertInsideViewport('bot card text', await getStableBox(text, page), viewport);
    }
    assert.equal(
      await card.evaluate((node) =>
        [...node.querySelectorAll('*')].some(
          (child) =>
            ['auto', 'scroll'].includes(getComputedStyle(child).overflowY) &&
            child.scrollHeight > child.clientHeight + 1
        )
      ),
      false,
      'the short card needs no scrolling'
    );
    await card
      .getByRole('button', { name: testCase.locale === 'sv' ? 'Stäng' : 'Close', exact: true })
      .click();
    await card.waitFor({ state: 'detached' });
    const entry = page.getByRole('button', { name: testCase.open });
    await entry.getByText(testCase.botCard, { exact: true }).click();
    await copy.waitFor();
    await card
      .getByRole('button', { name: testCase.locale === 'sv' ? 'Stäng' : 'Close', exact: true })
      .click();
    await card.waitFor({ state: 'detached' });
    await entry.locator('svg').first().click();
    await copy.waitFor();
    await waitForScreenshotReady(page);
  } else {
    const beside = !!testCase.landscapeText && viewport.width > viewport.height;
    const line = page
      .getByTestId(testCase.testId)
      .getByText(beside ? testCase.landscapeText : testCase.thinkingText, { exact: true });
    await line.waitFor();
    assertInsideViewport('thinking line', await getStableBox(line, page), viewport);
    assert.equal(
      await line.evaluate((node) => node.scrollWidth > node.clientWidth + 1),
      !!testCase.thinkingCut && !beside,
      testCase.thinkingCut && !beside
        ? 'a 40-character line is cut short'
        : 'thinking line fits the nameplate'
    );
    if (testCase.thinkingCut && !beside) {
      const seat = await getStableBox(page.getByTestId(testCase.testId), page);
      const box = await getStableBox(line, page);
      assert.ok(
        box.x >= seat.x - 1 && box.x + box.width <= seat.x + seat.width + 1,
        'the cut line stays inside its seat'
      );
    }
    await page.reload();
    await line.waitFor();
  }
}

// PID-267: the fixture's bots bid within 1.4s of the deal starting. Every
// sample while the seats still say they are dealing shows no bid, in a seat or
// in the log, and the deal must outlast the last bid for that to mean anything.
async function assertDealHold(page, testCase, viewport) {
  if (!testCase.dealHold) return;
  const dealing = /, (dealing|delar ut)$/i;
  const bid = /\b(bid|bud|passed|passat|high|högst)\b/i;
  const sample = () =>
    page.evaluate(() => ({
      labels: ['north', 'east', 'south', 'west'].map(
        (rel) =>
          document.querySelector(`[data-testid="seat-${rel}"]`)?.getAttribute('aria-label') ?? ''
      ),
      log: [...document.querySelectorAll('[data-testid^="ticker-line-"],[data-testid="bid-line"]')]
        .map((node) => node.textContent)
        .filter(Boolean),
    }));
  await page.waitForFunction(
    (pattern) =>
      new RegExp(pattern, 'i').test(
        document.querySelector('[data-testid="seat-east"]')?.getAttribute('aria-label') ?? ''
      ),
    dealing.source,
    { timeout: 20_000 }
  );
  const started = Date.now();
  let held = 0;
  for (;;) {
    const { labels, log } = await sample();
    if (!labels.every((label) => dealing.test(label))) break;
    const shown = labels.filter((label) => bid.test(label));
    if (shown.length || log.length) {
      throw new Error(
        `${testCase.name}: a bid shows while dealing in ${viewport.name}: ${[...shown, ...log].join(' | ')}`
      );
    }
    held = Date.now() - started;
    await page.waitForTimeout(150);
  }
  if (held < 1_600) {
    throw new Error(`${testCase.name}: the deal ended before the bots bid in ${viewport.name}`);
  }
}

async function assertBidLines(page, testCase, viewport) {
  if (!testCase.bidLines) return;
  for (const [seat, line] of Object.entries(testCase.bidLines)) {
    const avatar = page.getByTestId(`seat-${seat}`);
    const spoken = line.replace(/^./, (c) => c.toLowerCase());
    await page.waitForFunction(
      ([id, text]) =>
        document
          .querySelector(`[data-testid="${id}"]`)
          ?.getAttribute('aria-label')
          ?.endsWith(`, ${text}`),
      [`seat-${seat}`, spoken],
      { timeout: 10_000 }
    );
    const profileLabel = await avatar.evaluate((node) =>
      node.closest('[role="button"]')?.getAttribute('aria-label')
    );
    if (profileLabel) assert.ok(profileLabel.endsWith(`, ${spoken}`));
    const shown = [];
    for (const text of await avatar.getByText(/^(Bid|High|Passed|Bud|Högst|Passat)/).all()) {
      if (await text.isVisible()) shown.push(text);
    }
    if (shown.length !== 1) {
      throw new Error(`${testCase.name}: seat ${seat} shows no bid line in ${viewport.name}`);
    }
    const box = await getStableBox(shown[0], page);
    assertInsideViewport(`${testCase.name} ${seat} bid line`, box, viewport);
    const words = await shown[0].textContent();
    if (words === line) continue;
    const short = line
      .replace(/^Bid (\d+) · high$/, 'High $1')
      .replace(/^Bud (\d+) · högst$/, 'Högst $1');
    if (seat !== 'south' || words !== short) {
      throw new Error(`${testCase.name}: seat ${seat} shows "${words}" for "${line}"`);
    }
    const column = await getStableBox(avatar, page);
    if (box.x < column.x - 1 || box.x + box.width > column.x + column.width + 1) {
      throw new Error(`${testCase.name}: your bid line leaves its seat in ${viewport.name}`);
    }
  }
}

const TEAM_US = 'rgb(184, 198, 255)';
const TEAM_THEM = 'rgb(255, 180, 185)';

// PID-294: no seat has a light of its team's colour (the old soft glow under
// each seat), your and your partner's names share our colour, both opponents
// theirs, and the score's labels are the key to it.
async function assertTeams(page, testCase) {
  if (!testCase.teams) return;
  const seen = {};
  for (const position of ['north', 'east', 'south', 'west']) {
    const seat = page.getByTestId(`seat-${position}`).first();
    const { names, lights } = await seat.evaluate((root) => {
      const nodes = [...root.querySelectorAll('*')];
      const team = /(146, 230, 178|255, 180, 185|184, 198, 255)/;
      return {
        names: nodes
          .filter((n) => n.childElementCount === 0 && n.textContent.trim())
          .map((n) => getComputedStyle(n))
          .filter((style) => style.fontWeight === '800')
          .map((style) => style.color),
        lights: nodes
          .map((n) => getComputedStyle(n))
          .filter((style) => team.test(`${style.backgroundColor} ${style.boxShadow}`)).length,
      };
    });
    assert.equal(lights, 0, `${testCase.name}: seat-${position} has a team light`);
    assert.equal(names.length, 1, `${testCase.name}: seat-${position} has one name`);
    seen[position] = names[0];
  }
  // You sit south; a spectator's south is N/S too. Both fixtures watch from the
  // south, so this pins the N/S rule for a spectator, not an east/west viewer.
  const expected = { north: TEAM_US, south: TEAM_US, east: TEAM_THEM, west: TEAM_THEM };
  assert.deepEqual(seen, expected, `${testCase.name}: names in their team's colour`);
  const labels = testCase.teams === 'spectator' ? ['N/S', 'E/W'] : ['US', 'THEM'];
  const label = (text) =>
    page
      .getByText(text, { exact: true })
      .first()
      .evaluate((n) => getComputedStyle(n).color);
  assert.deepEqual(
    [await label(labels[0]), await label(labels[1])],
    [TEAM_US, TEAM_THEM],
    `${testCase.name}: the score's labels are the key to the names`
  );
}

// PID-383: the plaque keeps the header's height and its place beside the
// menu, with no faces since PID-387; the partner's seat says so in the first
// hand only; the sheet says whose side a seat plays on.
const PLAQUE_HEIGHT = 53;
async function assertTeamLines(page, testCase, viewport) {
  if (!testCase.teamCase) return;
  const where = `${testCase.name} in ${viewport.name}`;
  const sv = testCase.locale === 'sv';
  if (testCase.sheet) {
    const sheet = page.getByTestId(testCase.sheet);
    await sheet.waitFor();
    const line = sheet.getByTestId('player-sheet-team');
    if (testCase.teamLine == null) {
      await sheet.getByText('Eli', { exact: true }).first().waitFor();
      assert.equal(await line.count(), 0, `${where}: a spectator's sheet takes a side`);
      return;
    }
    // A person's sheet at the table puts the seat after their title (PID-406).
    const shown =
      testCase.sheet === 'player-sheet' ? sheet.getByTestId('player-sheet-title') : line;
    await shown.waitFor();
    const text = (await shown.innerText()).trim();
    assert.ok(
      testCase.sheet === 'player-sheet'
        ? text.endsWith(` · ${testCase.teamLine}`)
        : text === testCase.teamLine,
      `${where}: the sheet's line reads ${text}`
    );
    assertInsideViewport('team line', await getStableBox(shown, page), viewport);
    return;
  }
  const plaque = page.getByRole('button', { name: sv ? /^(VI|N\/S) / : /^(US|N\/S) / });
  const box = await getStableBox(plaque, page);
  assert.equal(Math.round(box.height), PLAQUE_HEIGHT, `${where}: the plaque grew`);
  // It keeps its width: 170pt, whatever the labels.
  assert.ok(box.width <= 171, `${where}: the plaque is ${box.width}pt wide`);
  assertInsideViewport('score plaque', box, viewport);
  const menu = await getStableBox(
    page.getByRole('button', { name: sv ? 'Bordsinställningar' : 'Table settings', exact: true }),
    page
  );
  assert.ok(box.x + box.width + 8 <= menu.x, `${where}: the plaque runs into the menu`);
  // PID-387: the plaque is labels and figures again; the faces were too small to read.
  assert.equal(
    await page.locator('[data-testid^="score-face"]').count(),
    0,
    `${where}: the plaque draws faces`
  );
  const north = await page.getByTestId('seat-north').getAttribute('aria-label');
  const partner = sv ? 'din partner' : 'your partner';
  assert.equal(
    north.endsWith(`, ${partner}`),
    testCase.partnerLine,
    `${where}: Antti's seat reads ${JSON.stringify(north)}`
  );
  if (testCase.partnerLine) {
    const line = page
      .getByTestId('seat-north')
      .getByText(sv ? 'Din partner' : 'Your partner', { exact: true });
    assert.equal(await line.count(), 1, `${where}: the partner line is not drawn`);
    assertInsideViewport('partner line', await line.boundingBox(), viewport);
  }
  // The control: Marcel's line still says what he played.
  assert.ok(
    (await page.getByTestId('seat-west').getAttribute('aria-label')).endsWith(
      sv ? 'spelar 5♦' : 'plays 5♦'
    ),
    `${where}: West's line`
  );
  // On tight phones the plaque is the only way to the hand log: it still opens.
  await plaque.click();
  await page.getByTestId('hand-history').waitFor();
  await page
    .getByTestId('table-utility-window')
    .getByRole('button', { name: sv ? /^Stäng/ : /^Close/ })
    .first()
    .click();
  await page.getByTestId('hand-history').waitFor({ state: 'detached' });
  console.log(
    `teams ${where}: plaque ${Math.round(box.width * 10) / 10}×${box.height}, partner line ${testCase.partnerLine}`
  );
}

async function assertTableDetails(page, testCase, viewport) {
  if (!testCase.details) return;
  const chips = page.locator('[data-testid$="-bid"]');
  if (testCase.details === 'bidding' || testCase.details === 'ended') {
    assert.equal(await chips.count(), 0, 'no reminder chip before or after the hand');
    return;
  }
  assert.equal(await chips.count(), 1, 'only the bidder has a chip');
  assert.equal(await chips.innerText(), testCase.detailsPhase === 'declaring' ? '8' : '7');
  assert.equal(
    await chips.evaluate((chip) => getComputedStyle(chip).borderTopColor),
    ['north', 'south'].includes(testCase.details) ? TEAM_US : TEAM_THEM,
    'chip uses the bidding team tone'
  );
  assertInsideViewport('bid chip', await chips.boundingBox(), viewport);
  const hand = await page.getByTestId('player-hand-top').boundingBox();
  const targets = JSON.parse(
    await page.getByTestId('play-presentation').getAttribute('aria-label')
  );
  const chip = await chips.boundingBox();
  assert.ok(
    chip.y + chip.height <= hand.y ||
      chip.x + chip.width <= hand.x ||
      chip.y >= hand.y + (targets.hand[0]?.h ?? 0),
    'bid chip stays clear of your hand'
  );
  const dealt = JSON.parse(await page.getByTestId('deal-presentation').getAttribute('aria-label'));
  if (!testCase.detailsPhase)
    assert.deepEqual(dealt.hand, [
      'spades_14',
      'spades_5',
      'clubs_5',
      'hearts_13',
      'clubs_13',
      'diamonds_13',
    ]);
  assert.equal(await page.getByTestId('last-trick').count(), 0, 'count help is independent');
  const poses = () =>
    page.locator('[data-testid$="-cards"] img').evaluateAll((images) =>
      images.map((image) => {
        const card = image.parentElement;
        const flight = card.parentElement;
        const fan = flight.parentElement;
        const north = !!image.closest('[data-testid="seat-north-cards"]');
        const count = fan.querySelectorAll('img').length;
        const index = [...fan.querySelectorAll('img')].indexOf(image);
        const step =
          count <= 1
            ? 0
            : north
              ? (parseFloat(fan.style.width) - parseFloat(flight.style.width)) / (count - 1)
              : (parseFloat(fan.style.height) - parseFloat(flight.style.height)) / (count - 1);
        return {
          north,
          index,
          step,
          rotation: card.style.transform,
          translation: flight.style.transform,
        };
      })
    );
  const before = await poses();
  assert.equal(
    before.length,
    testCase.detailsPhase === 'declaring' ? 27 : 18,
    'actual opponent backs'
  );
  for (const pose of before) {
    const angle = Number(pose.rotation.match(/rotate\(([-\d.]+)deg\)/)?.[1]);
    const x = Number(pose.translation.match(/translateX\(([-\d.]+)px\)/)?.[1]);
    const y = Number(pose.translation.match(/translateY\(([-\d.]+)px\)/)?.[1]);
    assert.ok(Math.abs(angle - (pose.north ? 0 : 90)) <= 1, 'at most one degree');
    assert.ok(
      Math.abs(x - (pose.north ? pose.index * pose.step : 0)) <= 1.01,
      'at most one pixel x'
    );
    assert.ok(
      Math.abs(y - (pose.north ? 0 : pose.index * pose.step)) <= 1.01,
      'at most one pixel y'
    );
  }
  await page.waitForTimeout(150);
  assert.deepEqual(await poses(), before, 'backs never jitter between frames');
  await page.getByRole('button', { name: 'Table settings', exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Show the bid during play', exact: true });
  assert.equal(await toggle.getAttribute('aria-checked'), 'true');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  assert.equal(await chips.count(), 0, 'off hides the bid immediately');
  await toggle.click();
  assert.equal(await chips.count(), 1, 'on restores it without count help');
  assert.deepEqual(await poses(), before, 'backs stay fixed across preference rerenders');
  await page.getByRole('button', { name: 'Close Table settings', exact: true }).click();
}

// A seat that played says so aloud and on screen, inside the viewport.
async function assertPlayLines(page, testCase, viewport) {
  if (!testCase.playLines) return;
  for (const [seat, line] of Object.entries(testCase.playLines)) {
    const avatar = page.getByTestId(`seat-${seat}`);
    const label = await avatar.getAttribute('aria-label');
    if (!label?.endsWith(`, ${line.replace(/^./, (c) => c.toLowerCase())}`)) {
      throw new Error(`${testCase.name}: seat ${seat} says "${label}" for "${line}"`);
    }
    const text = avatar.getByText(line, { exact: true });
    if ((await text.count()) !== 1 || !(await text.isVisible())) {
      throw new Error(`${testCase.name}: seat ${seat} does not show "${line}" in ${viewport.name}`);
    }
    assertInsideViewport(
      `${testCase.name} ${seat} play line`,
      await getStableBox(text, page),
      viewport
    );
  }
}

// PID-304: each seat (avatar, name, status and corner badges) keeps off the
// others, every played card and your hand; the dealer
// chip sits bottom left, the winning bid top right at the bot badge's size.
// Tight phones show no ticker or Last trick: the score panel opens the log.
const STATUS_SEATS = {
  a: {
    south: { name: 'Bengt', chip: '★4' },
    west: { name: 'Mikko', chip: '12' },
    north: { name: 'Aino', chip: '6' },
    east: { name: 'Kalle', chip: '100' },
  },
  b: {
    south: { name: 'Bengt', chip: '★4' },
    west: { name: 'Antti', bot: true },
    north: { name: 'Aino', chip: '6' },
    east: { name: 'Jussi', chip: '31' },
  },
};

// PID-338: three layers, never mixed, read from the real boxes. The chip is
// centred under its avatar and says what `chipFor` gives for the seat's
// level and stars (level 100 with 4 stars reads ★4), bots have none, no
// pin is drawn at the table, the dealer chip holds the bottom-left quadrant
// clear of cards, the name and the chip, and the bid holds the top right.
async function assertStatusSeats(page, testCase, viewport) {
  if (!testCase.statusSeats) return;
  const players = STATUS_SEATS[testCase.statusSeats];
  const where = `${testCase.name} in ${viewport.name}`;
  await page.waitForTimeout(450);
  // A badge and the avatar it sits on: the badge's own box, and its avatar's.
  const onAvatar = (id, up = 1) =>
    page.getByTestId(id).evaluate((node, up) => {
      let avatar = node;
      for (let i = 0; i < up; i++) avatar = avatar.parentElement;
      const box = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
      return {
        badge: box(node.getBoundingClientRect()),
        avatar: box(avatar.getBoundingClientRect()),
      };
    }, up);
  // Tight phones drop your own name under your hand: then there is none to clear.
  const nameBox = async (rel, name) => {
    const text = page.getByTestId(`seat-${rel}`).getByText(name, { exact: true });
    return (await text.count()) ? text.boundingBox() : null;
  };
  const centre = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const overlap = (a, b) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  assert.equal(
    await page.locator('[data-testid^="seat-"][data-testid$="-pin"]').count(),
    0,
    `${where}: a pin is drawn at the table`
  );
  const chips = {};
  // A tight phone shows no chips at the table and drops your name too.
  const tight = !(await nameBox('south', 'Bengt'));
  for (const [rel, player] of Object.entries(players)) {
    const level = page.getByTestId(`seat-${rel}-level`);
    if (player.bot) {
      assert.equal(await level.count(), 0, `${where}: the bot at ${rel} has a level chip`);
      continue;
    }
    if (!testCase.statusCut || tight) {
      assert.equal(await level.count(), 0, `${where}: ${rel} shows a level during the hand`);
      continue;
    }
    assert.equal(await level.count(), 1, `${where}: ${rel} has no chip at the cut`);
    // The chip sits in a full-width row inside the avatar.
    const { badge, avatar } = await onAvatar(`seat-${rel}-level`, 2);
    chips[rel] = badge;
    assert.equal((await level.innerText()).trim(), player.chip, `${where}: ${rel}'s chip`);
    assert.ok(
      Math.abs(centre(badge).x - centre(avatar).x) <= 1,
      `${where}: ${rel}'s chip is ${centre(badge).x - centre(avatar).x}pt off centre`
    );
    const name = await nameBox(rel, player.name);
    if (name) assert.ok(!overlap(badge, name), `${where}: ${rel}'s chip overlaps the name`);
  }
  if (testCase.statusCut) {
    console.log(
      `status-seats ${where}: ${tight ? 'tight, no chips' : `chips ${JSON.stringify(Object.fromEntries(Object.keys(chips).map((rel) => [rel, players[rel].chip])))}`}`
    );
    return;
  }
  const dealer = await onAvatar('seat-south-dealer');
  const d = centre(dealer.badge);
  const a = centre(dealer.avatar);
  assert.ok(d.x < a.x && d.y > a.y, `${where}: the dealer chip leaves the bottom-left quadrant`);
  const sprites = await page.evaluate(() => window.__pidroCardMotion());
  for (const card of sprites.map(spriteBox))
    assert.ok(!overlap(dealer.badge, card), `${where}: the dealer chip overlaps ${card.label}`);
  const bengt = await nameBox('south', 'Bengt');
  if (bengt)
    assert.ok(!overlap(dealer.badge, bengt), `${where}: the dealer chip overlaps the name`);
  const bid = await onAvatar('seat-north-bid');
  const b = centre(bid.badge);
  const n = centre(bid.avatar);
  assert.ok(b.x > n.x && b.y < n.y, `${where}: the bid leaves the top-right quadrant`);
  assert.equal((await page.getByTestId('seat-north-bid').innerText()).trim(), '9');
  console.log(
    `status-seats ${where}: chips ${JSON.stringify(Object.keys(chips))}, dealer (${Math.round(d.x - a.x)}, ${Math.round(d.y - a.y)}) from centre, bid (${Math.round(b.x - n.x)}, ${Math.round(b.y - n.y)})`
  );
}

/** A card sprite's screen box, rotation included. */
function spriteBox(s) {
  const c = Math.abs(Math.cos(s.rotation));
  const n = Math.abs(Math.sin(s.rotation));
  const width = (s.width * c + s.height * n) * s.renderedScale;
  const height = (s.width * n + s.height * c) * s.renderedScale;
  return { label: s.key, x: s.x - width / 2, y: s.y - height / 2, width, height };
}

async function assertSmallTable(page, testCase, viewport) {
  if (!testCase.smallTable) return;
  const { dealer, bidder, played = 0 } = testCase.smallTable;
  await page.getByTestId(`rendered-played-card-count-${played}`).waitFor();
  await page.waitForTimeout(450);
  const sprites = await page.evaluate(() => window.__pidroCardMotion());
  const cards = sprites.filter((s) => s.kind === 'played').map(spriteBox);
  const hand = sprites.filter((s) => s.kind === 'hand').map(spriteBox);
  assert.equal(cards.length, played, `${testCase.name}: every played card is measured`);
  assert.ok(hand.length > 0, `${testCase.name}: your hand is measured`);
  const union = (boxes) => {
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    return {
      x,
      y,
      width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
      height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
    };
  };
  const seats = {};
  for (const rel of ['north', 'east', 'south', 'west']) {
    const parts = [await getStableBox(page.getByTestId(`seat-${rel}`).first(), page)];
    for (const badge of ['dealer', 'bid', 'bot']) {
      const node = page.getByTestId(`seat-${rel}-${badge}`);
      if (await node.count()) parts.push(await node.first().boundingBox());
    }
    seats[rel] = { ...union(parts), label: `seat-${rel}` };
    assertInsideViewport(`${testCase.name} seat-${rel}`, seats[rel], viewport);
  }
  const apart = (a, b) =>
    a.x + a.width <= b.x + 0.5 ||
    b.x + b.width <= a.x + 0.5 ||
    a.y + a.height <= b.y + 0.5 ||
    b.y + b.height <= a.y + 0.5;
  // Playable cards rise out of the row: the hand is where they rest too.
  const rest = await page.getByTestId('player-hand-top').boundingBox();
  hand.push({ ...hand[0], y: rest.y, height: Math.max(...hand.map((h) => h.height)) });
  const others = [...cards, { ...union(hand), label: 'your hand' }];
  const rels = Object.keys(seats);
  for (const [i, a] of rels.entries()) {
    for (const b of rels.slice(i + 1)) {
      assert.ok(apart(seats[a], seats[b]), `${testCase.name}: seat-${a} overlaps seat-${b}`);
    }
    for (const other of others) {
      assert.ok(
        apart(seats[a], other),
        `${testCase.name}: seat-${a} overlaps ${other.label} in ${viewport.name}: ${JSON.stringify({ seat: seats[a], other })}`
      );
    }
  }
  // One meaning per corner, read against the avatar each badge sits on.
  const corner = (id) =>
    page.getByTestId(id).evaluate((node) => {
      const badge = node.getBoundingClientRect();
      const avatar = node.parentElement.getBoundingClientRect();
      return {
        right: badge.x + badge.width / 2 > avatar.x + avatar.width / 2,
        below: badge.y + badge.height / 2 > avatar.y + avatar.height / 2,
        size: badge.width,
      };
    });
  assert.equal(await page.locator('[data-testid$="-dealer"]').count(), 1, 'one dealer chip');
  const d = await corner(`seat-${dealer}-dealer`);
  assert.ok(!d.right && d.below, `${testCase.name}: the dealer chip sits bottom left`);
  const b = await corner(`seat-${bidder}-bid`);
  assert.ok(b.right && !b.below, `${testCase.name}: the winning bid sits top right`);
  const bot = await page.getByTestId('seat-east-bot').boundingBox();
  assert.ok(
    Math.abs(b.size - bot.width) <= 0.5,
    `${testCase.name}: bid ${b.size}pt, bot ${bot.width}pt`
  );
  if (viewport.name !== 'compact-portrait') return;
  assert.equal(await page.getByTestId('last-trick').count(), 0, 'tight phones show no Last trick');
  assert.equal(
    await page.getByRole('button', { name: /Opens this hand's log/ }).count(),
    0,
    'tight phones show no ticker'
  );
  await page.getByRole('button', { name: /Every hand\.$/ }).click();
  await page.getByTestId('hand-history-this-hand').click();
  await page.getByText('This hand', { exact: true }).waitFor();
  assert.equal(await page.getByTestId('hand-history').count(), 0, 'the log replaces the panel');
}

// PID-305, PID-307: landscape phones lay the table out as Classic does. Every
// seat (its badges included), hand row (the backs, your faces), front row
// (thrown, killed or played cards) and the trump mark keeps TRICK_GAP from
// every other; the table of their rectangles prints in dp. Seats, front rows
// and the mark stay on screen; hands may bleed past their edge, but yours
// always shows its rank and suit. The bid window and hand result touch none.
async function assertTwoRows(page, testCase, viewport) {
  if (!testCase.twoRows) return;
  const {
    thrown = [],
    played = 0,
    result = false,
    faces = {},
    killed = [],
    mark = false,
    pack: dealing = false,
  } = testCase.twoRows;
  const rels = ['north', 'east', 'south', 'west'];
  const named = (label, b) => ({ label, x: b.x, y: b.y, width: b.width, height: b.height });
  const union = (label, boxes) => {
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    const r = Math.max(...boxes.map((b) => b.x + b.width));
    const btm = Math.max(...boxes.map((b) => b.y + b.height));
    return { label, x, y, width: r - x, height: btm - y };
  };
  const images = async (testId) => {
    const boxes = [];
    for (const image of await page.getByTestId(testId).locator('img').all()) {
      const box = await image.boundingBox();
      if (box) boxes.push(box);
    }
    return boxes;
  };
  for (const rel of thrown) {
    await page.getByTestId(`second-deal-thrown-${rel}`).waitFor({ timeout: 20_000 });
  }
  for (const rel of killed) await page.getByTestId(`killed-${rel}`).waitFor({ timeout: 20_000 });
  // The last throw lands.
  if (thrown.length || killed.length) await page.waitForTimeout(700);
  for (const rel of thrown) {
    const shown = await page
      .getByTestId(`second-deal-thrown-${rel}`)
      .getByTestId('thrown-face')
      .count();
    assert.equal(shown, faces[rel] ?? 0, `${testCase.name}: ${rel}'s pile shows ${shown} faces`);
  }
  for (const rel of killed) {
    const shown = await page.getByTestId(`killed-${rel}`).getByTestId('thrown-face').count();
    assert.ok(shown > 0, `${testCase.name}: ${rel}'s killed trumps lie face up`);
  }
  await page.getByTestId(`rendered-played-card-count-${played}`).waitFor({ timeout: 20_000 });
  if (played) await page.waitForTimeout(600);
  const sprites = await page.evaluate(() => window.__pidroCardMotion?.() ?? []);
  for (const card of sprites.filter((s) => s.kind === 'played'))
    assertFacesMiddle(`${testCase.name}: ${card.key}`, card.key.split('-')[3], card);
  const spriteBox = (s) => {
    const c = Math.abs(Math.cos(s.rotation));
    const n = Math.abs(Math.sin(s.rotation));
    const width = (s.width * c + s.height * n) * s.renderedScale;
    const height = (s.width * n + s.height * c) * s.renderedScale;
    return { label: s.key, x: s.x - width / 2, y: s.y - height / 2, width, height };
  };
  const seats = [];
  const handRows = [];
  const fronts = [];
  for (const rel of rels) {
    // A seat is its avatar and label, and each badge on the avatar's corners.
    const box = await getStableBox(page.getByTestId(`seat-${rel}`).first(), page);
    const seat = [named(`${rel}'s seat`, box)];
    for (const badge of ['dealer', 'bid', 'bot', 'level', 'pin']) {
      const node = page.getByTestId(`seat-${rel}-${badge}`);
      const part = (await node.count()) ? await node.first().boundingBox() : null;
      if (part) seat.push(named(`${rel}'s ${badge}`, part));
    }
    for (const part of seat) assertInsideViewport(`${testCase.name} ${part.label}`, part, viewport);
    seats.push(seat);
    if (rel !== 'south') {
      const backs = await images(`seat-${rel}-cards`);
      if (backs.length) handRows.push(union(`${rel}'s backs`, backs));
    }
    const front = [
      ...(await images(`second-deal-thrown-${rel}`)),
      ...(await images(`killed-${rel}`)),
      ...sprites.filter((s) => s.kind === 'played' && s.key.split('-')[3] === rel).map(spriteBox),
    ];
    if (front.length) {
      const row = union(`${rel}'s front row`, front);
      assertInsideViewport(`${testCase.name} ${row.label}`, row, viewport);
      fronts.push(row);
    }
  }
  // Only the trick on the table (PID-307): a seat that kept seven trumps may
  // put two cards into it, every other seat one.
  assert.equal(
    fronts.length,
    Math.max(thrown.length + killed.length, Math.min(played, 4)),
    `${testCase.name}: front rows`
  );
  const hand = sprites.filter((s) => s.kind === 'hand').map(spriteBox);
  if (hand.length) {
    const row = union('your hand', hand);
    // Pushed down to the bottom edge, past it on short phones, but its rank
    // and suit (the top 58% of a card) and a 44pt tap target always show.
    const rest = await page.getByTestId('player-hand-top').boundingBox();
    const cardH = cardSize(viewport.width, viewport.height) * (110 / 78);
    assert.ok(
      viewport.height - rest.y >= Math.max(44, cardH * 0.58) - 0.01,
      `${testCase.name}: your hand shows ${viewport.height - rest.y}pt`
    );
    handRows.push({ ...row, height: Math.min(row.height, viewport.height - row.y) });
  }
  // The dealer's pack beside them (PID-394), on screen like a seat.
  const pack = await images('dealer-pack');
  const packs = pack.length ? [union("the dealer's pack", pack)] : [];
  assert.ok(
    !dealing || packs.length,
    `${testCase.name}: the dealer's pack shows in ${viewport.name}`
  );
  for (const box of packs) assertInsideViewport(`${testCase.name} ${box.label}`, box, viewport);
  // Each thing is one or more rectangles: a seat's badges apart from it.
  const table = [...seats, ...[...handRows, ...fronts, ...packs].map((b) => [b])];
  if (mark) {
    const center = await page.getByTestId('table-trick-center').boundingBox();
    const size = cardSize(viewport.width, viewport.height) * TRUMP_MARK;
    const markBox = {
      label: 'the trump mark',
      x: center.x - size / 2,
      y: center.y - size / 2,
      width: size,
      height: size,
    };
    assertInsideViewport(`${testCase.name} the trump mark`, markBox, viewport);
    table.push([markBox]);
  }
  const gap = (a, b) =>
    Math.max(
      b.x - (a.x + a.width),
      a.x - (b.x + b.width),
      b.y - (a.y + a.height),
      a.y - (b.y + b.height)
    );
  // Every rectangle of one thing against every rectangle of every other.
  const pairs = [
    ...table.flatMap((a, i) =>
      table.slice(i + 1).flatMap((b) => a.flatMap((pa) => b.map((pb) => [pa, pb, gap(pa, pb)])))
    ),
  ];
  const closest = pairs.reduce((min, pair) => (pair[2] < min[2] ? pair : min));
  const dp = (v) => v.toFixed(1).padStart(6);
  console.log(
    [
      `two rows ${testCase.name} ${viewport.name} (${viewport.width}×${viewport.height}), in dp:`,
      ...table
        .flat()
        .map(
          (b) => `  ${b.label.padEnd(20)} x${dp(b.x)} y${dp(b.y)} w${dp(b.width)} h${dp(b.height)}`
        ),
      `  smallest gap ${closest[2].toFixed(1)}: ${closest[0].label} – ${closest[1].label}`,
    ].join('\n')
  );
  for (const [a, b, apart] of pairs)
    assert.ok(
      apart >= TRICK_GAP - 0.05,
      `${testCase.name}: ${a.label} and ${b.label} are ${apart.toFixed(1)}pt apart in ${viewport.name}, under ${TRICK_GAP}: ${JSON.stringify({ a, b })}`
    );
  const windows = [];
  for (const id of ['bidding-window', 'trump-picker', 'hand-result-panel']) {
    const node = page.getByTestId(id);
    if (await node.count()) windows.push(named(id, await getStableBox(node.first(), page)));
  }
  if (result) assert.equal(windows.length, 1, `${testCase.name}: the hand result shows`);
  // The hand's result dims the seats under it on purpose (PID-236); it only keeps off the hands.
  for (const w of windows)
    for (const b of [
      ...handRows,
      ...fronts,
      ...packs,
      ...(w.label === 'hand-result-panel' ? [] : seats.flat()),
    ])
      assert.ok(
        gap(w, b) >= 0,
        `${testCase.name}: ${w.label} overlaps ${b.label} in ${viewport.name}`
      );
  // Landscape phones show no bid line or Last trick; the score panel opens the log.
  assert.equal(await page.getByTestId('last-trick').count(), 0, 'landscape phones: no Last trick');
  assert.equal(
    await page.getByRole('button', { name: /Opens this hand's log/ }).count(),
    0,
    'landscape phones: no bid line'
  );
}

// PID-388: a side seat's played card points its top at the middle, as its
// player lays it: East's turned a quarter left, West's a quarter right.
function assertFacesMiddle(label, rel, card) {
  if (rel !== 'east' && rel !== 'west') return;
  const turn = Math.sin(card.rotation) * (rel === 'west' ? 1 : -1);
  assert.ok(turn > 0.99, `${label} points its top at the middle (${card.rotation} rad)`);
}

// PID-381: on upright phones each seat's newest card lies in front at full
// size and its earlier ones behind it, all of one smaller size and shaded,
// but for point cards with count help on. Each earlier card shows at least
// 0.16 of a card, and on 390×844 up to five deep its whole index: the card
// art's rank and suit reach 0.357 of its width.
const POINT_RANKS = [14, 11, 10, 5, 2];
function assertPiles(testCase, viewport, cards, { counted = false, out }) {
  const part = (s, i) => Number(s.key.split('-')[i]);
  const liveTrick = Math.max(...cards.map((s) => part(s, 1)));
  const full = Math.max(...cards.map((s) => s.scale));
  const behind = new Set();
  const cardW = cardSize(viewport.width, viewport.height);
  for (const rel of ['north', 'east', 'south', 'west']) {
    const pile = cards
      .filter((s) => s.key.split('-')[3] === rel)
      .sort((a, b) => part(a, 1) - part(b, 1) || part(a, 2) - part(b, 2));
    const last = part(pile.at(-1), 1);
    pile.forEach((s, i) => {
      const label = `${testCase.name} ${viewport.name}: ${rel}'s ${s.key}`;
      const front = rel !== out && part(s, 1) === last;
      if (front) assert.ok(Math.abs(s.scale - full) < 0.001, `${label} is full size`);
      else behind.add(s.scale.toFixed(4));
      const lit = counted && POINT_RANKS.includes(Number(s.key.split('_').at(-1)));
      const shaded = !lit && (!front || last !== liveTrick);
      assert.ok(
        Math.abs(s.shade - (shaded ? 1 : 0)) < 0.01,
        `${label} ${shaded ? 'is' : 'is not'} shaded: ${s.shade}`
      );
      assertFacesMiddle(label, rel, s);
      const next = pile[i + 1];
      if (!next) return;
      // How much of this card the next one leaves at its index: a side card's
      // lies at the foot at East and at the top at West (PID-388).
      const w = (c) => c.width * c.scale;
      const shown =
        rel === 'east'
          ? s.y + w(s) / 2 - (next.y + w(next) / 2)
          : rel === 'west'
            ? next.y - w(next) / 2 - (s.y - w(s) / 2)
            : next.x - w(next) / 2 - (s.x - w(s) / 2);
      assert.ok(shown >= cardW * 0.16 - 0.05, `${label} shows ${shown.toFixed(1)}pt`);
      if (viewport.name === 'portrait' && pile.length <= 5)
        assert.ok(
          shown >= w(s) * 0.357 - 0.05,
          `${label} shows ${shown.toFixed(1)}pt of its ${(w(s) * 0.357).toFixed(1)}pt index`
        );
    });
  }
  assert.ok(behind.size <= 1, `${testCase.name}: earlier cards are one size: ${[...behind]}`);
  for (const scale of behind) {
    const ratio = Number(scale) / full;
    assert.ok(ratio >= 0.75 && ratio < 0.9, `${testCase.name}: earlier cards at ${ratio}`);
  }
}

// PID-381: when West's next card lands, its last one settles back where it
// lies, to the earlier cards' size and shade: in one motion after the new card
// has landed, or with Reduce Motion in one cut.
async function assertSettle(page, testCase, viewport, reduced) {
  await page.getByTestId('rendered-played-card-count-20').waitFor({ timeout: 20_000 });
  const frames = await page.evaluate(
    () =>
      new Promise((done) => {
        const frames = [];
        let landed;
        const sample = () => {
          const at = performance.now();
          const played = (window.__pidroCardMotion?.() ?? []).filter((s) => s.kind === 'played');
          const card = played.find((s) => s.key.startsWith('trick-4-') && s.key.includes('-west-'));
          if (played.length === 21) landed ??= at;
          frames.push({ at, count: played.length, card });
          if (landed !== undefined && at - landed > 1200) done(frames);
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      })
  );
  const before = frames[0].card;
  const after = frames.at(-1).card;
  const landed = frames.find((f) => f.count === 21).at;
  const label = `${testCase.name} ${viewport.name}`;
  assert.equal(before.shade, 0, `${label}: West's last card is lit before`);
  assert.equal(after.shade, 1, `${label}: West's last card is shaded after`);
  assert.ok(Math.abs(after.scale / before.scale - 0.8) < 0.001, `${label}: it settles to 0.8`);
  assert.ok(Math.abs(after.x - before.x) < 0.5, `${label}: it stays in West's column`);
  const between = frames.filter(
    (f) => f.card.scale < before.scale - 0.001 && f.card.scale > after.scale + 0.001
  );
  const scales = frames.map((f) => f.card.scale);
  assert.ok(
    scales.every((v, i) => !i || v <= scales[i - 1] + 1e-6),
    `${label}: one motion, never back up`
  );
  if (reduced) assert.equal(between.length, 0, `${label}: Reduce Motion cuts`);
  else {
    assert.ok(between.length >= 3, `${label}: it settles in motion (${between.length} frames)`);
    const start = between[0].at - landed;
    const end = frames.find((f) => f.card.scale <= after.scale + 0.001).at - landed;
    assert.ok(start >= 250 && end <= 340 + 250 + 200, `${label}: settles ${start}–${end}ms`);
    console.log(
      `settle ${label}: from ${start.toFixed(0)}ms to ${end.toFixed(0)}ms after the lead`
    );
  }
}

// PID-333: on upright phones every seat (its badges included), back fan,
// played card, throw, the trump mark and your hand keep off one another; the
// bid window and hand result keep off your hand. The rectangles and the drawn
// card heights print in dp, and (PID-393) where East and West sit against
// the trick's line.
async function assertUpright(page, testCase, viewport) {
  if (!testCase.upright) return;
  const {
    thrown = [],
    played = 0,
    result = false,
    mark = false,
    ended = result,
    piles,
    pack: dealing = false,
  } = testCase.upright;
  const named = (label, b) => ({ label, x: b.x, y: b.y, width: b.width, height: b.height });
  const union = (label, boxes) => {
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    const r = Math.max(...boxes.map((b) => b.x + b.width));
    const btm = Math.max(...boxes.map((b) => b.y + b.height));
    return { label, x, y, width: r - x, height: btm - y };
  };
  const images = async (testId) => {
    const boxes = [];
    for (const image of await page.getByTestId(testId).locator('img').all()) {
      const box = await image.boundingBox();
      if (box) boxes.push(box);
    }
    return boxes;
  };
  for (const rel of thrown) {
    await page.getByTestId(`second-deal-thrown-${rel}`).waitFor({ timeout: 20_000 });
  }
  if (thrown.length) await page.waitForTimeout(700);
  if (piles?.settle) await assertSettle(page, testCase, viewport, piles.reduced);
  await page.getByTestId(`rendered-played-card-count-${played}`).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(600);
  const sprites = await page.evaluate(() => window.__pidroCardMotion?.() ?? []);
  const spriteBox = (s) => {
    const c = Math.abs(Math.cos(s.rotation));
    const n = Math.abs(Math.sin(s.rotation));
    const width = (s.width * c + s.height * n) * s.renderedScale;
    const height = (s.width * n + s.height * c) * s.renderedScale;
    return { label: s.key, x: s.x - width / 2, y: s.y - height / 2, width, height };
  };
  const table = [];
  for (const rel of ['north', 'east', 'south', 'west']) {
    const seat = [
      named(`${rel}'s seat`, await getStableBox(page.getByTestId(`seat-${rel}`).first(), page)),
    ];
    for (const badge of ['dealer', 'bid', 'bot', 'level']) {
      const node = page.getByTestId(`seat-${rel}-${badge}`);
      const part = (await node.count()) ? await node.first().boundingBox() : null;
      if (part) seat.push(named(`${rel}'s ${badge}`, part));
    }
    for (const part of seat) assertInsideViewport(`${testCase.name} ${part.label}`, part, viewport);
    table.push(seat);
    if (rel !== 'south') {
      const backs = await images(`seat-${rel}-cards`);
      if (backs.length) table.push([union(`${rel}'s backs`, backs)]);
    }
    const throws = await images(`second-deal-thrown-${rel}`);
    if (throws.length) table.push([union(`${rel}'s throw`, throws)]);
  }
  // The dealer's pack beside them (PID-394).
  const pack = await images('dealer-pack');
  const packBox = pack.length ? union("the dealer's pack", pack) : null;
  assert.ok(!dealing || packBox, `${testCase.name}: the dealer's pack shows in ${viewport.name}`);
  if (packBox) {
    assertInsideViewport(`${testCase.name} ${packBox.label}`, packBox, viewport);
    table.push([packBox]);
  }
  // A seat's cards in a trick lie as one pile.
  const cards = sprites.filter((s) => s.kind === 'played');
  assert.equal(cards.length, played, `${testCase.name}: every played card is measured`);
  if (piles) assertPiles(testCase, viewport, cards, piles);
  for (const rel of ['north', 'east', 'south', 'west']) {
    // Card by card: a pile's earlier cards hang past its newest (PID-381).
    const pile = cards
      .filter((s) => s.key.split('-')[3] === rel)
      .map((s, i) => ({ ...spriteBox(s), label: `${rel}'s card ${i + 1}` }));
    if (pile.length) table.push(pile);
  }
  // A hand that has ended has no cards left to hold.
  const held = sprites.filter((s) => s.kind === 'hand');
  assert.ok(ended || held.length > 0, `${testCase.name}: your hand is measured`);
  let hand = null;
  if (held.length) {
    // Playable cards rise out of the row: the hand is where they rest too.
    const rest = await page.getByTestId('player-hand-top').boundingBox();
    const handBoxes = held.map(spriteBox);
    hand = union('your hand', [...handBoxes, { ...handBoxes[0], y: rest.y }]);
    assertInsideViewport(`${testCase.name} your hand`, hand, viewport);
    table.push([hand]);
  }
  // PID-393: East's and West's backs end TRICK_GAP above a lifted card of yours.
  const cardH = cardSize(viewport.width, viewport.height) * (110 / 78);
  const rest = hand ? (await page.getByTestId('player-hand-top').boundingBox()).y : Infinity;
  const lifted = rest - Math.min(16, cardH * 0.14) - (cardH * 0.015 + 2.5);
  for (const rel of ['east', 'west']) {
    const backs = await images(`seat-${rel}-cards`);
    if (!backs.length) continue;
    const bottom = Math.max(...backs.map((b) => b.y + b.height));
    assert.ok(
      bottom <= lifted - TRICK_GAP + 1,
      `${testCase.name}: ${rel}'s backs reach a lifted card of yours in ${viewport.name}: ${bottom} > ${lifted} - ${TRICK_GAP}`
    );
  }
  if (mark) {
    const center = await page.getByTestId('table-trick-center').boundingBox();
    const size = cardSize(viewport.width, viewport.height) * TRUMP_MARK;
    table.push([
      {
        label: 'the trump mark',
        x: center.x - size / 2,
        y: center.y - size / 2,
        width: size,
        height: size,
      },
    ]);
  }
  const gap = (a, b) =>
    Math.max(
      b.x - (a.x + a.width),
      a.x - (b.x + b.width),
      b.y - (a.y + a.height),
      a.y - (b.y + b.height)
    );
  const pairs = table.flatMap((a, i) =>
    table.slice(i + 1).flatMap((b) => a.flatMap((pa) => b.map((pb) => [pa, pb, gap(pa, pb)])))
  );
  const closest = pairs.reduce((min, pair) => (pair[2] < min[2] ? pair : min));
  const dp = (v) => v.toFixed(1).padStart(6);
  const tall = (s) => (s.height * s.scale).toFixed(1);
  // PID-393: where East's and West's avatars sit against the trick's line, and their backs' step.
  const line = (await page.getByTestId('table-trick-center').boundingBox())?.y;
  const sides = ['west', 'east'].map((rel) => {
    const seat = table.flat().find((b) => b.label === `${rel}'s seat`);
    return `${rel} ${(seat.y + Math.min(seat.height, 56) / 2 - line).toFixed(1)}`;
  });
  const westBacks = (await images('seat-west-cards')).map((b) => b.y).sort((a, b) => a - b);
  const step =
    westBacks.length > 1 ? (westBacks.at(-1) - westBacks[0]) / (westBacks.length - 1) : 0;
  console.log(
    [
      `upright ${testCase.name} ${viewport.name} (${viewport.width}×${viewport.height}), in dp:`,
      `  card heights: your hand ${held.length ? held[0].height.toFixed(1) : '–'}, played ${cards.length ? tall(cards[0]) : '–'}`,
      `  side avatars from the trick's line (y ${line?.toFixed(1)}): ${sides.join(', ')}; west's backs ${westBacks.length} at ${step.toFixed(1)} apart`,
      ...table
        .flat()
        .map(
          (b) => `  ${b.label.padEnd(20)} x${dp(b.x)} y${dp(b.y)} w${dp(b.width)} h${dp(b.height)}`
        ),
      `  smallest gap ${closest[2].toFixed(1)}: ${closest[0].label} – ${closest[1].label}`,
    ].join('\n')
  );
  for (const [a, b, apart] of pairs)
    assert.ok(
      apart >= -0.5,
      `${testCase.name}: ${a.label} overlaps ${b.label} in ${viewport.name}: ${JSON.stringify({ a, b })}`
    );
  const windows = [];
  for (const id of ['bidding-window', 'trump-picker', 'hand-result-panel']) {
    const node = page.getByTestId(id);
    if (await node.count()) windows.push(named(id, await getStableBox(node.first(), page)));
  }
  if (result) assert.equal(windows.length, 1, `${testCase.name}: the hand result shows`);
  for (const w of windows)
    for (const b of [hand, packBox])
      if (b) assert.ok(gap(w, b) >= 0, `${testCase.name}: ${w.label} overlaps ${b.label}`);
}

// Folded backs stay in their seat's hand area, never on any Skia played card,
// including the retained history. Read actual sprite transforms, not DOM proxies.
async function assertFoldGeometry(page, testCase, viewport) {
  const expected = testCase.playedCount ?? (testCase.countHelp ? 8 : 0);
  await page.getByTestId(`rendered-played-card-count-${expected}`).waitFor();
  await page.waitForTimeout(450);
  const played = await page.evaluate(() =>
    window.__pidroCardMotion().filter((s) => s.kind === 'played')
  );
  assert.equal(played.length, expected, 'The overlap check must see every played card');
  if (testCase.playedCount && expected) {
    assert.ok(played.some((s) => s.key.endsWith('north-hearts_6')));
    const seat = Object.keys(testCase.fold)[0];
    assert.ok(
      played.some((s) => s.key.endsWith(`${seat}-hearts_9`) && s.leading),
      '9♥ keeps its winning glow'
    );
    if (testCase.completedFold) {
      // Tight and landscape phones have no Last trick (PID-304, PID-305).
      if (
        viewport.height > viewport.width
          ? viewport.height >= 700
          : Math.min(viewport.width, viewport.height) >= 600
      )
        assert.equal(
          await page.getByTestId('last-trick').getAttribute('aria-label'),
          'Last trick, trick 1'
        );
      assert.match(await page.getByTestId('seat-south').getAttribute('aria-label'), /, out$/);
    }
  }
  const boxes = played.map((s) => {
    assert.equal(s.flight, 1, 'Measure landed played cards');
    const c = Math.abs(Math.cos(s.rotation));
    const n = Math.abs(Math.sin(s.rotation));
    const width = (s.width * c + s.height * n) * s.renderedScale;
    const height = (s.width * n + s.height * c) * s.renderedScale;
    return { key: s.key, x: s.x - width / 2, y: s.y - height / 2, width, height };
  });
  const north = await page.getByTestId('trick-north-top').boundingBox();
  const south = await page.getByTestId('player-hand-top').boundingBox();
  for (const seat of Object.keys(
    testCase.fold ?? Object.fromEntries(testCase.countHelp.folded.map((s) => [s, 0]))
  )) {
    const identity = await page.getByTestId(`seat-${seat}`).boundingBox();
    for (const image of await page.getByTestId(`seat-${seat}-folded`).locator('img').all()) {
      const b = await image.boundingBox();
      assertInsideViewport(`${testCase.name} ${seat} folded back`, b, viewport);
      assert.ok(
        b.x + b.width <= identity.x ||
          identity.x + identity.width <= b.x ||
          b.y + b.height <= identity.y ||
          identity.y + identity.height <= b.y,
        `${testCase.name}: folded back overlaps ${seat}'s avatar, name or level`
      );
      for (const card of boxes) {
        assert.ok(
          b.x + b.width <= card.x ||
            card.x + card.width <= b.x ||
            b.y + b.height <= card.y ||
            card.y + card.height <= b.y,
          `${testCase.name}: ${seat} folded back overlaps played ${card.key}`
        );
      }
      const inSeat =
        seat === 'north'
          ? b.y + b.height <= north.y
          : seat === 'south'
            ? b.y >= south.y
            : seat === 'west'
              ? b.x + b.width <= viewport.width / 4
              : b.x >= (viewport.width * 3) / 4;
      assert.ok(
        inSeat,
        `${testCase.name}: ${seat} folded back is outside its hand area: ${JSON.stringify(b)}`
      );
    }
  }
}

// PID-366: a settled hand laid down. Each of the holder's cards lies face up
// on screen, clear of every seat; the holder says they take the rest; with
// count help the trick points and the 2's ride on the fan; no result yet,
// and your own laid cards have left your hand. The next hand, sent with it,
// waits: nobody is on turn, the dealer chip stays, no bid window.
async function assertLayDown(page, testCase, viewport) {
  if (!testCase.layDown) return;
  const { rel, cards, count, sv } = testCase.layDown;
  const fan = page.getByTestId(`lay-down-${rel}`);
  await fan.waitFor({ timeout: 30_000 });
  // Every card down.
  await page.waitForTimeout(700);
  const faces = fan.getByTestId('thrown-face');
  assert.equal(await faces.count(), cards, `${testCase.name}: ${cards} cards face up`);
  const seats = [];
  for (const seat of ['north', 'east', 'south', 'west'])
    seats.push([seat, await getStableBox(page.getByTestId(`seat-${seat}`).first(), page)]);
  for (const face of await faces.all()) {
    const card = await getStableBox(face, page);
    assertInsideViewport(`${testCase.name} laid card`, card, viewport);
    for (const [seat, box] of seats)
      assert.ok(!overlaps(card, box), `${testCase.name}: a laid card clears ${seat}'s seat`);
  }
  const said = await page.getByTestId(`seat-${rel}`).first().getAttribute('aria-label');
  assert.match(
    said,
    sv ? /tar resten/i : /takes the rest/i,
    `${testCase.name}: ${rel} says ${said}`
  );
  const pops = page.getByTestId('lay-down-pops');
  assert.equal(await pops.count(), count ? 1 : 0, `${testCase.name}: points on the fan`);
  // Five cards are the A, K, J, 5 and 2: 1 + 1 + 5 and the 2's own point; two are the 5 and 2.
  if (count)
    assert.deepEqual(
      await pops.getByText(/^\+\d+$/).allInnerTexts(),
      [cards === 5 ? '+7' : '+5', '+1'],
      `${testCase.name}: the fan's points`
    );
  for (const pop of await pops.getByText(/^\+\d+$/).all())
    assertInsideViewport(`${testCase.name} point`, await getStableBox(pop, page), viewport);
  assert.equal(
    await page.locator('[data-testid="hand-result"], [data-testid="hand-points"]').count(),
    0,
    `${testCase.name}: the result waits for the gather`
  );
  if (rel === 'south') await page.getByTestId('rendered-hand-card-count-0').waitFor();
  const seatsAround = ['north', 'east', 'south', 'west'];
  const after = (n) => seatsAround[(seatsAround.indexOf(rel) + n) % 4];
  for (const seat of seatsAround.filter((seat) => seat !== rel)) {
    const line = await page.getByTestId(`seat-${seat}`).first().getAttribute('aria-label');
    assert.doesNotMatch(line, /playing|spelar/i, `${testCase.name}: ${seat} says ${line}`);
  }
  // The fixture's dealer is on the holder's right; the next hand's, on their left.
  assert.equal(
    await page.getByTestId(`seat-${after(3)}-dealer`).count(),
    1,
    'the dealer chip stays'
  );
  assert.equal(await page.getByTestId(`seat-${after(1)}-dealer`).count(), 0, 'no next dealer yet');
  assert.equal(
    await page.getByTestId('bidding-window').count(),
    0,
    `${testCase.name}: no bid window`
  );
}

// PID-332: no panel, no scrim and no headline; ours | theirs over the trump
// mark, clear of the seats and of every card still on the table.
async function assertClassicEnd(page, testCase, viewport) {
  if (!testCase.classicEnd) return;
  const { us, them, played, own = false } = testCase.classicEnd;
  await page.getByTestId(`rendered-played-card-count-${played}`).waitFor({ timeout: 20_000 });
  if (played) await page.waitForTimeout(600);
  assert.equal(await page.getByTestId('hand-result').count(), 0, `${testCase.name}: no panel`);
  const points = page.getByTestId('hand-points');
  const figures = page.getByTestId('hand-points').getByText(/^−?\d+$/);
  assert.deepEqual(await figures.allInnerTexts(), [us, them], `${testCase.name}: ours | theirs`);
  const label = await page.getByLabel(/^Us .*, Them .*$/).getAttribute('aria-label');
  assert.equal(label, `Us ${us}, Them ${them}`, `${testCase.name}: spoken points`);
  const first = await getStableBox(figures.first(), page);
  const last = await getStableBox(figures.last(), page);
  const row = {
    x: first.x,
    y: Math.min(first.y, last.y),
    width: last.x + last.width - first.x,
    height: Math.max(first.height, last.height),
  };
  assertInsideViewport(`${testCase.name} points`, row, viewport);
  const center = await page.getByTestId('table-trick-center').boundingBox();
  assert.ok(
    Math.abs(row.y + row.height / 2 - (center.y + center.height / 2)) < 2 &&
      Math.abs(row.x + row.width / 2 - (center.x + center.width / 2)) < 2,
    `${testCase.name}: the points sit over the trump mark`
  );
  // About as tall as a card's corner rank, or larger.
  const size = Number.parseFloat(
    await figures.first().evaluate((el) => getComputedStyle(el).fontSize)
  );
  assert.ok(size >= 28, `${testCase.name}: figures ${size}px`);
  const sprites = await page.evaluate(() => window.__pidroCardMotion?.() ?? []);
  for (const s of sprites.filter((sprite) => sprite.kind === 'played')) {
    const c = Math.abs(Math.cos(s.rotation));
    const n = Math.abs(Math.sin(s.rotation));
    const width = (s.width * c + s.height * n) * s.renderedScale;
    const height = (s.width * n + s.height * c) * s.renderedScale;
    const card = { x: s.x - width / 2, y: s.y - height / 2, width, height };
    assert.ok(!overlaps(row, card), `${testCase.name}: the points clear ${s.key}`);
  }
  for (const rel of ['north', 'east', 'south', 'west']) {
    const seat = await page.getByTestId(`seat-${rel}`).first().boundingBox();
    assert.ok(!overlaps(row, seat), `${testCase.name}: the points clear ${rel}'s seat`);
  }
  // Beside its cards each seat says the last one it played; alone, nothing.
  for (const rel of ['north', 'east', 'south', 'west']) {
    const said = await page.getByTestId(`seat-${rel}`).first().getAttribute('aria-label');
    assert.equal(/plays/.test(said), played > 0, `${testCase.name}: ${rel} says ${said}`);
  }
  // Seats stay lit: nothing dims the table.
  assert.equal(
    await page
      .getByTestId('seat-north')
      .first()
      .evaluate((el) => {
        for (let node = el; node; node = node.parentElement)
          if (Number(getComputedStyle(node).opacity) < 1) return false;
        return true;
      }),
    true,
    `${testCase.name}: the seats do not fade`
  );
  const tap = page.getByTestId('hand-points-continue');
  assert.equal(await tap.count(), own ? 1 : 0, `${testCase.name}: tap to continue`);
  assert.equal(
    await points.getByText('Tap to continue', { exact: true }).count(),
    own ? 1 : 0,
    `${testCase.name}: the quiet line`
  );
}

// Count help (PID-220): the bid line reads in full and, with "Last trick",
// keeps off every seat and North's cards. An out seat says so aloud and lays
// its cards face down on the felt.
async function assertCountHelp(page, testCase, viewport) {
  const help = testCase.countHelp;
  if (!help) return;
  const seats = ['north', 'east', 'south', 'west'];
  const spoken = (seat, text) =>
    page.waitForFunction(
      ([id, words]) =>
        document
          .querySelector(`[data-testid="${id}"]`)
          ?.getAttribute('aria-label')
          ?.endsWith(`, ${words}`),
      [`seat-${seat}`, text],
      { timeout: 10_000 }
    );
  const words = help.words ?? { out: 'out', lone: 'takes the rest' };
  for (const seat of help.out) await spoken(seat, words.out);
  for (const seat of help.folded) {
    const cards = page.getByTestId(`seat-${seat}-folded`);
    await cards.waitFor({ timeout: 10_000 });
    for (const image of await cards.locator('img').all()) {
      assert.match(await image.getAttribute('src'), /cardback\.png/);
      assertInsideViewport(
        `${testCase.name} ${seat} back`,
        await getStableBox(image, page),
        viewport
      );
    }
  }
  if (help.lone) await spoken(help.lone, words.lone);
  if (!help.line) return;
  const bidLine = page.getByTestId('bid-line');
  if (
    viewport.height > viewport.width
      ? viewport.height < 700
      : Math.min(viewport.width, viewport.height) < 600
  ) {
    // Tight and landscape phones (PID-305): no bid line, no Last trick; the
    // score panel opens the log, trick 2 in it.
    assert.equal(await bidLine.count(), 0, `${testCase.name}: no bid line on a tight phone`);
    assert.equal(
      await page.getByTestId('last-trick').count(),
      0,
      `${testCase.name}: no Last trick`
    );
    await page.getByRole('button', { name: /(Every hand|Alla givar)\.$/ }).click();
    await page.getByTestId('hand-history-this-hand').click();
    await page
      .getByText(testCase.locale === 'sv' ? 'Stick 2' : 'Trick 2', { exact: true })
      .waitFor();
    await page
      .getByRole('button', { name: testCase.locale === 'sv' ? 'Stäng' : 'Close' })
      .first()
      .click();
    return;
  }
  await bidLine.getByText(help.line, { exact: true }).waitFor({ timeout: 10_000 });
  const who = bidLine.getByText(help.bidder, { exact: true });
  if (await who.evaluate((el) => el.scrollWidth > el.clientWidth + 1)) {
    throw new Error(`${testCase.name}: the bidder's name is cut short in ${viewport.name}`);
  }
  const pieces = {
    'bid line': await getStableBox(bidLine, page),
    'last trick': await getStableBox(page.getByTestId('last-trick'), page),
  };
  const others = { 'north cards': page.getByTestId('seat-north-cards').locator(':scope > div') };
  for (const seat of seats) others[`${seat} seat`] = page.getByTestId(`seat-${seat}`);
  for (const [name, box] of Object.entries(pieces)) {
    assertInsideViewport(`${testCase.name} ${name}`, box, viewport);
    for (const [otherName, other] of Object.entries(others)) {
      const otherBox = await visibleBox(page, other);
      if (otherBox && boxesOverlap(box, otherBox)) {
        throw new Error(
          `${testCase.name}: the ${name} overlaps the ${otherName} in ${viewport.name}`
        );
      }
    }
  }
}

// PID-209: four suit buttons of 64pt or more, a grid in portrait and a row in
// landscape, clear of every seat and its cards, with each suit's trumps
// counted (hearts and the 5♦ make four).
async function assertTrumpPicker(page, testCase, box, viewport) {
  await assertAbovePlayerHand(page, testCase.name, box, viewport);
  const choices = await page.getByTestId('trump-picker').getByRole('button').all();
  assert.equal(choices.length, 4, `${testCase.name}: four suits in ${viewport.name}`);
  const boxes = [];
  for (const choice of choices) {
    const choiceBox = await getStableBox(choice, page);
    assert.ok(
      choiceBox.width >= 64 && choiceBox.height >= 64,
      `${testCase.name}: a trump button under 64pt in ${viewport.name}`
    );
    boxes.push(choiceBox);
  }
  const rows = new Set(boxes.map((b) => Math.round(b.y))).size;
  assert.equal(
    rows,
    viewport.height > viewport.width ? 2 : 1,
    `${testCase.name}: trump buttons in ${rows} rows in ${viewport.name}`
  );
  const hearts = testCase.locale === 'sv' ? 'Hjärter, 4 trumf' : 'Hearts, 4 trumps';
  await page.getByRole('button', { name: hearts, exact: true }).waitFor({ timeout: 10_000 });
  const others = {};
  for (const seat of ['north', 'east', 'west', 'south']) {
    others[`${seat} seat`] = page.getByTestId(`seat-${seat}`);
    others[`${seat} cards`] = page.getByTestId(`seat-${seat}-cards`).locator(':scope > div');
  }
  for (const [name, other] of Object.entries(others)) {
    const otherBox = await visibleBox(page, other);
    if (otherBox && boxesOverlap(box, otherBox)) {
      throw new Error(
        `${testCase.name}: the trump picker overlaps the ${name} in ${viewport.name}: picker=${JSON.stringify(box)} ${name}=${JSON.stringify(otherBox)}`
      );
    }
  }
}

// PID-258: the invitation reads in full, stays inside the safe edges, and
// leaves the hand, the bids and (but on landscape phones) North's played card
// uncovered. Not now closes it.
async function assertTableInvitation(page, testCase, viewport) {
  if (!testCase.invitation) return;
  const card = page.getByTestId('table-invitation');
  const short = viewport.width > viewport.height ? viewport.height < 500 : viewport.height < 700;
  if (testCase.testId === 'bidding-window' && short) {
    assert.equal(
      await card.count(),
      0,
      `${testCase.name}: waits while you bid in ${viewport.name}`
    );
    return;
  }
  const box = await getStableBox(card, page);
  assertInsideViewport(`${testCase.name} card`, box, viewport);
  for (const text of [
    'Bertil is holding a seat for you',
    testCase.invitation,
    'Joining ends your game with the bots.',
  ])
    await card.getByText(text, { exact: true }).waitFor();
  const insets = testCase.insets ?? { left: 0, right: 0 };
  assert.ok(box.x >= insets.left, `${testCase.name}: clears the left inset`);
  assert.ok(
    box.x + box.width <= viewport.width - insets.right,
    `${testCase.name}: clears the right inset`
  );
  if (viewport.height > viewport.width) {
    await assertNorthClear(page, testCase, viewport, box);
    for (const seat of ['east', 'west', 'south']) {
      const seatBox = await visibleBox(page, page.getByTestId(`seat-${seat}`));
      assert.ok(
        !seatBox || !boxesOverlap(box, seatBox),
        `${testCase.name}: clears the ${seat} seat in ${viewport.name}`
      );
    }
  }
  // Landscape phones keep it in the header row, over North's two rows (PID-305)
  // until you answer; elsewhere it stops above North's played card.
  const bottom = box.y + box.height;
  const north = await getStableBox(page.getByTestId('trick-north-top').first(), page);
  assert.ok(
    (viewport.width > viewport.height && viewport.height < 500) || bottom <= north.y + 0.5,
    `${testCase.name}: clears North's played card in ${viewport.name}`
  );
  await assertAbovePlayerHand(page, testCase.name, box, viewport, biddingClearance(viewport));
  for (const button of await page.getByTestId('bidding-window').getByRole('button').all()) {
    const bid = await getStableBox(button, page);
    assert.ok(!boxesOverlap(box, bid), `${testCase.name}: clears the bids in ${viewport.name}`);
  }
  await card.getByRole('button', { name: 'Not now', exact: true }).click();
  await card.waitFor({ state: 'detached' });
}

// The bidding window stays centred on the trick; on tight phones, your seat
// under the hand (PID-304) leaves it its own 18pt floor above the hand, where
// no card is lifted while you bid.
const biddingClearance = (viewport) =>
  viewport.height > viewport.width && viewport.height < 700 ? 18 : undefined;

async function assertAbovePlayerHand(page, name, box, viewport, clearance) {
  const handBoundary = page.getByTestId('player-hand-top').first();
  await handBoundary.waitFor({ state: 'attached', timeout: 20_000 });
  const handBox = await getStableBox(handBoundary, page);
  if (!handBox) throw new Error(`${name} player-hand boundary has no geometry`);
  const handTop = handBox.y;
  const minimumClearance = clearance ?? (viewport.height >= viewport.width ? 28 : 8);

  // Layout/card transforms can land on opposite sides of a half-pixel boundary.
  if (box.y + box.height > handTop - minimumClearance + 0.5) {
    throw new Error(
      `${name} is too close to the player hand in ${viewport.name}: window=${JSON.stringify(box)} protectedHandTop=${handTop} minimumClearance=${minimumClearance}`
    );
  }
}

async function assertBidGridLayout(page, viewport, locale) {
  const bid = locale === 'sv' ? 'Bud' : 'Bid';
  const bidButtons = await page.getByRole('button', { name: new RegExp(`^${bid} \\d+$`) }).all();
  if (bidButtons.length !== 9) {
    throw new Error(
      `bidding grid has ${bidButtons.length} values instead of 9 in ${viewport.name}`
    );
  }

  const boxes = [];
  for (const button of bidButtons) {
    const box = await getStableBox(button, page);
    if (!box) throw new Error(`bidding grid has a value without geometry in ${viewport.name}`);
    boxes.push(box);
  }

  const uniqueCoordinates = (values) => {
    const unique = [];
    for (const value of values.sort((a, b) => a - b)) {
      if (!unique.some((candidate) => Math.abs(candidate - value) <= 2)) unique.push(value);
    }
    return unique;
  };
  const columns = uniqueCoordinates(boxes.map((box) => box.x));
  const rows = uniqueCoordinates(boxes.map((box) => box.y));
  if (columns.length !== 3 || rows.length !== 3) {
    throw new Error(
      `bidding values are not a 3x3 grid in ${viewport.name}: columns=${columns.length} rows=${rows.length}`
    );
  }

  const passBox = await getStableBox(page.getByRole('button', { name: 'Pass', exact: true }), page);
  const gridBottom = Math.max(...boxes.map((box) => box.y + box.height));
  if (!passBox || passBox.y < gridBottom + 4) {
    throw new Error(
      `Pass is not below the bidding grid in ${viewport.name}: pass=${JSON.stringify(passBox)} gridBottom=${gridBottom}`
    );
  }

  if (viewport.height >= viewport.width) {
    const centerButton = await getStableBox(page.getByRole('button', { name: `${bid} 10` }), page);
    const trickCenter = await getStableBox(page.getByTestId('table-trick-center').first(), page);
    if (!centerButton || !trickCenter) {
      throw new Error(`bidding center has no geometry in ${viewport.name}`);
    }
    const centerOffset = Math.abs(
      centerButton.y + centerButton.height / 2 - (trickCenter.y + trickCenter.height / 2)
    );
    // Tight phones (PID-304): your seat under the hand leaves the grid less
    // room below the trick, so it may rise above the marker, never sink below.
    const risen =
      viewport.height < 700 &&
      centerButton.y + centerButton.height / 2 <= trickCenter.y + trickCenter.height / 2 + 2;
    if (centerOffset > 2 && !risen) {
      throw new Error(
        `Bid 10 is not centered on the trick marker in ${viewport.name}: offset=${centerOffset}`
      );
    }
  }
}

// A side stack may bleed off a bare screen edge, never into a cutout.
async function assertSideStacksInsideCutouts(page, testCase, viewport) {
  const { left, right } = testCase.sideInsets;
  for (const [position, inset] of [
    ['west', left],
    ['east', right],
  ]) {
    if (!inset) continue;
    const stack = page.getByTestId(`seat-${position}-cards`).locator(':scope > div').first();
    await stack.waitFor({ state: 'visible', timeout: 20_000 });
    const box = await getStableBox(stack, page);
    const outside =
      position === 'west' ? inset - box.x : box.x + box.width - (viewport.width - inset);
    if (outside > 0.5) {
      throw new Error(
        `${testCase.name}: the ${position} card stack reaches ${outside.toFixed(1)}pt into the cutout in ${viewport.name}: ${JSON.stringify(box)}`
      );
    }
  }
}

async function assertSeatPlacement(page, viewport) {
  const entries = await Promise.all(
    ['north', 'east', 'south', 'west'].map(async (position) => {
      const locator = page.getByTestId(`seat-${position}`).first();
      await locator.waitFor({ state: 'visible', timeout: 20_000 });
      const box = await getStableBox(locator, page);
      if (!box) throw new Error(`seat-${position} has no landscape geometry`);
      return [position, box];
    })
  );
  const seats = Object.fromEntries(entries);
  const centerX = (box) => box.x + box.width / 2;
  const horizontalCenter = viewport.width / 2;
  const portrait = viewport.height >= viewport.width;

  const centeredPositions = portrait ? ['north', 'south'] : [];
  for (const position of centeredPositions) {
    if (Math.abs(centerX(seats[position]) - horizontalCenter) > 2) {
      throw new Error(
        `seat-${position} is not horizontally centered: ${JSON.stringify(seats[position])}`
      );
    }
  }

  if (!portrait && seats.south.x + seats.south.width >= horizontalCenter - 8) {
    throw new Error(
      `seat-south is not parked left of the landscape hand: ${JSON.stringify(seats.south)}`
    );
  }

  if (!portrait) {
    const hand = await getStableBox(page.getByTestId('player-hand-top').first(), page);
    if (seats.south.x + seats.south.width > hand.x) {
      throw new Error(
        `seat-south runs into the landscape hand: south=${JSON.stringify(seats.south)} handLeft=${hand.x}`
      );
    }
  }

  if (!portrait && seats.north.x <= horizontalCenter + 8) {
    throw new Error(
      `seat-north is not parked right of the landscape hand: ${JSON.stringify(seats.north)}`
    );
  }

  // PID-393: nothing docks under your seat any more; the felt runs to the edge.
  if (portrait && (await page.getByTestId('table-utility-dock').count())) {
    throw new Error('a portrait table still docks a panel under the hand');
  }

  // Portrait: North and South own a centered name column; East and West share
  // the rest. Landscape labels sit beside the avatar and stay compact.
  const maxSeatWidth = (position) =>
    !portrait ? 132 : position === 'north' || position === 'south' ? 156 : 112;
  for (const position of ['north', 'east', 'south', 'west']) {
    if (seats[position].width > maxSeatWidth(position)) {
      throw new Error(
        `seat-${position} exceeds the compact ${viewport.name} width: ${JSON.stringify(seats[position])}`
      );
    }
  }

  // Roomy landscape phones stagger them as Classic does, names under the
  // avatar: West at the top of its backs, East at their foot (PID-308).
  const staggered = !portrait && seats.west.height > 80 && seats.east.height > 80;
  if (
    staggered
      ? seats.west.y <= seats.north.y + 12 || seats.east.y <= seats.west.y
      : Math.abs(seats.east.y - seats.west.y) > 2 || seats.east.y <= seats.north.y + 12
  ) {
    throw new Error(
      `opponent seats do not form the intended landscape triangle: north=${JSON.stringify(seats.north)} east=${JSON.stringify(seats.east)} west=${JSON.stringify(seats.west)}`
    );
  }

  if (seats.south.y <= seats.east.y + seats.east.height) {
    throw new Error(
      `seat-south is not below the opponent row: south=${JSON.stringify(seats.south)}`
    );
  }
}

async function assertNamesFit(page, viewport, northNameMin = 0) {
  const seats = {};
  for (const position of ['north', 'east', 'south', 'west']) {
    const seat = page.getByTestId(`seat-${position}`).first();
    const box = await getStableBox(seat, page);
    assertInsideViewport(`seat-${position}`, box, viewport);
    const spill = await seat.locator('[dir="auto"]').evaluateAll(
      (nodes, { x, right }) =>
        nodes
          .map((node) => node.getBoundingClientRect())
          .filter((label) => label.width && (label.left < x - 1 || label.right > right + 1))
          .map((label) => [label.left, label.right]),
      { x: box.x, right: box.x + box.width }
    );
    if (spill.length) {
      throw new Error(
        `seat-${position}'s label runs out of its seat in ${viewport.name}: ${JSON.stringify({ box, spill })}`
      );
    }
    seats[position] = box;
  }
  const northName = page
    .getByTestId('seat-north')
    .first()
    .getByText('Alexandria the Long-Named Player', { exact: true });
  const northNameWidth = northNameMin ? (await getStableBox(northName, page)).width : 0;
  if (northNameWidth < northNameMin) {
    throw new Error(`seat-north's name is cut to ${northNameWidth}pt in ${viewport.name}`);
  }
  const apart = (a, b) =>
    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
  const positions = Object.keys(seats);
  for (const [i, a] of positions.entries()) {
    for (const b of positions.slice(i + 1)) {
      if (!apart(seats[a], seats[b])) {
        throw new Error(`seat-${a} overlaps seat-${b} in ${viewport.name}`);
      }
    }
  }
  const hand = await getStableBox(page.getByTestId('player-hand-top').first(), page);
  for (const position of ['north', 'east', 'west']) {
    if (seats[position].y + seats[position].height > hand.y) {
      throw new Error(`seat-${position} reaches the hand in ${viewport.name}`);
    }
  }
  if (viewport.width > viewport.height && seats.south.x + seats.south.width > hand.x) {
    throw new Error(`seat-south runs into the landscape hand in ${viewport.name}`);
  }
}

async function assertSwitchInteractions(page, name, screenshotDir) {
  if (name !== 'ui-components' && name !== 'settings' && name !== 'device-settings') return;
  const gallery = name === 'ui-components';
  const first = page.getByRole('switch', {
    name: gallery ? 'Enabled example' : 'Sound',
    exact: true,
  });
  const second = page.getByRole('switch', {
    name: gallery ? 'Off example' : 'Haptics',
    exact: true,
  });
  const checked = (control) => control.getAttribute('aria-checked');
  assert.equal(await checked(first), 'true');
  assert.equal(await checked(second), gallery ? 'false' : 'true');
  await first.click();
  assert.equal(await checked(first), 'false');
  assert.equal(await checked(second), gallery ? 'false' : 'true', 'Settings must be independent');
  await first.press('Space');
  assert.equal(await checked(first), 'true', 'Space must toggle exactly once');
  await first.press('Enter');
  assert.equal(await checked(first), 'false', 'Enter must toggle exactly once');
  if (gallery) {
    for (const [label, value] of [
      ['Disabled on', 'true'],
      ['Disabled off', 'false'],
    ]) {
      const control = page.getByRole('switch', { name: label, exact: true });
      assert.equal(await control.isDisabled(), true);
      await control.dispatchEvent('click');
      assert.equal(await checked(control), value, 'Disabled switch must retain its state');
    }
    await first.press('Tab');
    assert.equal(await second.evaluate((el) => el === document.activeElement), true);
    await page
      .getByTestId('ui-switch-panel')
      .screenshot({ path: resolve(screenshotDir, 'ui-switches.png') });
  } else {
    const bid = page.getByRole('switch', { name: 'Show the bid during play', exact: true });
    const count = page.getByRole('switch', { name: 'Help me keep count', exact: true });
    const originalCount = await checked(count);
    assert.equal(await checked(bid), 'true');
    await bid.click();
    assert.equal(await checked(bid), 'false');
    assert.equal(await checked(count), originalCount, 'Bid reminder is independent of count help');
    await page.reload();
    await first.waitFor();
    assert.equal(await checked(first), 'false', 'Sound preference must survive reload');
    assert.equal(await checked(second), 'true', 'Haptics must remain unchanged');
    assert.equal(await checked(bid), 'false', 'Bid preference must survive reload');
  }
}

// The light row controls (PID-241): the × always names its row, a rules chip
// is one radio of a pair, the count stops at 99+, and the sm pill keeps 44pt.
async function assertRowControls(page, name, screenshotDir) {
  if (name !== 'ui-components') return;
  const panel = page.getByTestId('ui-row-controls-panel');
  const dismiss = panel.getByRole('button', { name: 'Ignore Pekka’s request', exact: true });
  const box = await dismiss.boundingBox();
  assert.ok(box.width >= 44 && box.height >= 44, 'The dismiss × is a 44pt target');
  const sm = await page
    .getByTestId('ui-pills-sm')
    .getByRole('button', { name: 'Join', exact: true })
    .boundingBox();
  assert.ok(sm.height >= 44, 'The sm pill keeps a 44pt target');
  assert.equal(await panel.getByRole('button', { name: 'Adding' }).isDisabled(), true);
  const finnish = page.getByRole('radio', { name: 'Ostrobothnian', exact: true });
  const louisiana = page.getByRole('radio', { name: 'Louisiana', exact: true });
  assert.equal(await finnish.getAttribute('aria-checked'), 'true');
  await louisiana.click();
  assert.equal(await louisiana.getAttribute('aria-checked'), 'true');
  assert.equal(await finnish.getAttribute('aria-checked'), 'false');
  assert.deepEqual(
    await page.getByTestId('ui-count-badges').locator('[dir="auto"]').allInnerTexts(),
    ['1', '12', '99', '99+', '3', '99+', '2', '99+'],
    'A zero count hides; past 99 reads 99+, the green online count too'
  );
  await panel.getByRole('button', { name: 'Add', exact: true }).first().focus();
  await panel.screenshot({ path: resolve(screenshotDir, 'ui-row-controls-focus.png') });
}

// Friend rows and notices (PID-242): a name never wraps, the row is one
// labelled target that opens the sheet, and every control keeps 44pt.
async function assertFriendComponents(page, name, screenshotDir) {
  if (name !== 'ui-components') return;
  const rows = page.getByTestId('ui-friend-rows-panel');
  const notices = page.getByTestId('ui-friend-notices-panel');
  const long = rows.getByRole('button', {
    name: 'View Alexandria the Long-Named Player of Helsinki’s profile',
    exact: true,
  });
  const hit = await long.boundingBox();
  assert.ok(hit.height >= 48, 'A friend row opens the sheet from a 48pt target');
  const nameBox = await long
    .getByText('Alexandria the Long-Named Player of Helsinki', { exact: true })
    .boundingBox();
  assert.ok(nameBox.height <= 24, 'A long name stays on one line');
  assert.ok(nameBox.x + nameBox.width <= hit.x + hit.width + 1, 'A long name is truncated');
  for (const box of await rows
    .getByRole('button')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()))) {
    assert.ok(box.width >= 44 && box.height >= 44, 'Every friend row control is a 44pt target');
  }
  for (const box of await notices
    .getByRole('button')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()))) {
    assert.ok(box.height >= 44, 'Every notice button is a 44pt target');
  }
  // The panels are taller than a phone, and the gallery scrolls inside the
  // window: grow the window, keep its width, so each panel is captured whole.
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport.width, height: 3200 });
  await rows.screenshot({ path: resolve(screenshotDir, 'ui-friend-rows.png') });
  await notices.screenshot({ path: resolve(screenshotDir, 'ui-friend-notices.png') });
  await page.setViewportSize(viewport);
  const solo = page.getByTestId('ui-friend-notice-solo');
  await solo.getByRole('button', { name: 'Not now', exact: true }).click();
  await solo.waitFor({ state: 'detached' });
  await notices.getByRole('button', { name: 'Show the notice', exact: true }).click();
  await solo.waitFor();
}

async function assertSeatPicker(page, testCase, viewport) {
  if (!testCase.name.startsWith('ui-seat-picker-')) return;
  const container = page.getByTestId('seat-picker-container');
  const swedish = testCase.name.endsWith('-sv');
  const split =
    viewport.width > viewport.height || Math.min(viewport.width, viewport.height) >= 600;
  const choices = testCase.name.endsWith('-choices');
  if (split || choices) {
    const group = page.getByRole('radiogroup', { name: 'Opponent seat' });
    assert.equal(await group.getByRole('radio').count(), 5);
    assert.equal(await group.getByRole('radio', { checked: true }).count(), 1);
    const current = group.getByRole('radio', { checked: true });
    await current.focus();
    await current.press('ArrowDown');
    assert.equal(await container.count(), 1, 'Arrow keys browse without closing');
    assert.equal(await current.getAttribute('aria-checked'), 'true', 'Browsing does not commit');
    const next = group.getByRole('radio', { name: /^1000\+ games played,/ });
    assert.ok(await next.evaluate((el) => el === document.activeElement));
    assert.equal(await next.getAttribute('tabindex'), '0');
    await next.press(viewport.width > viewport.height ? 'Enter' : 'Space');
    await container.waitFor({ state: 'detached' });
    assert.equal(await page.getByTestId('seat-picker-result').innerText(), '1000');
    await page.getByRole('button', { name: 'Open seat picker', exact: true }).click();
    if (!split) {
      await page
        .getByRole('button', { name: 'A friend, Choose who to invite', exact: true })
        .click();
      await page.getByRole('link', { name: '‹ Opponent seat', exact: true }).waitFor();
    }
  }
  const picker = page.getByTestId('friend-picker');
  if (testCase.name.endsWith('-empty')) {
    await picker.getByText('No friends yet', { exact: true }).waitFor();
    await picker.getByRole('link', { name: 'Add friends', exact: true }).click();
    await container.waitFor({ state: 'detached' });
    assert.equal(await page.getByTestId('seat-picker-result').innerText(), 'Add friends');
    return;
  }
  const scroll = page.getByTestId('friend-picker-scroll');
  if (testCase.name.endsWith('-many')) {
    assert.equal(await picker.getByRole('button').count(), 30);
    const before = await container.boundingBox();
    const scrolled = await scroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      return el.scrollHeight > el.clientHeight && el.scrollTop > 0;
    });
    assert.ok(scrolled, '30 friends scroll inside the picker');
    await picker.getByText('Friend 23', { exact: true }).scrollIntoViewIfNeeded();
    assert.deepEqual(await container.boundingBox(), before, 'container stays fixed');
  }
  const unavailable = picker.getByLabel(
    swedish ? 'Nora, I ett spel med andra' : 'Nora, In a game with others',
    { exact: true }
  );
  assert.equal(await unavailable.getAttribute('aria-disabled'), 'true');
  const taken = picker.getByLabel(
    swedish
      ? 'Sanna, Redan inbjuden till en annan plats'
      : 'Sanna, Already invited to another seat',
    { exact: true }
  );
  assert.equal(await taken.getAttribute('aria-disabled'), 'true');
  const search = picker.getByRole('textbox', { name: swedish ? 'Hitta en vän' : 'Find a friend' });
  await search.fill('  PEKKA ');
  assert.equal(await picker.getByRole('button').count(), 1);
  await picker
    .getByRole('button', { name: swedish ? 'Bjud in Pekka' : 'Invite Pekka', exact: true })
    .click();
  await container.waitFor({ state: 'detached' });
  assert.equal(await page.getByTestId('seat-picker-result').innerText(), 'Pekka');
}

// PID-316: the server's side of Tell us. Answers come back in order; every post is kept.
async function routeFeedback(page, testCase) {
  page.tellPosts = [];
  const asks =
    testCase.tell === 'pace'
      ? [{ ask: 'old_pidro', game_id: 'fixture-game' }, { ask: null }]
      : testCase.tell === 'notice'
        ? [{ ask: 'pace', game_id: 'g-1' }]
        : [{ ask: null }];
  await page.route('**/api/v1/feedback/ask', (route) =>
    route.fulfill({ json: { data: asks.length > 1 ? asks.shift() : asks[0] } })
  );
  await page.route('**/api/v1/feedback', async (route) => {
    page.tellPosts.push(route.request().postDataJSON());
    // Long enough to see the card lie face down while the note travels.
    if (testCase.tell === 'send') await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.fulfill(
      testCase.tell === 'send-fails'
        ? { status: 503, json: { error: 'unavailable' } }
        : { status: 201, json: { data: { id: 42 } } }
    );
  });
}

const tellCopy = (testCase) =>
  testCase.tellLocale === 'sv'
    ? {
        door: 'Nyheter',
        title: 'Hej, jag är Marcel.',
        ask: 'Vad har du lagt märke till? Kändes det fel är det vårt fel, inte ditt.',
        placeholder: 'Skriv här, eller tryck på mikrofonen på tangentbordet och säg det.',
        reply: 'Vi svarar till bengt@example.com',
        change: 'Ändra',
        send: 'Skicka',
        fine: 'Appversion, telefon och senaste spelet följer med.',
        thanks: 'Tack. Vi läser varenda en.',
        after: 'Om vi svarar går det till bengt@example.com.',
        done: 'Klar',
        failed: 'Det gick inte iväg. Dina ord finns kvar.',
        retry: 'Försök igen',
        mailApp: 'Använd min e-postapp',
        limit: 'Det räcker för i dag, tack. Dina ord ligger kvar till i morgon.',
        limitButton: 'Skicka i morgon',
        account: 'Skapa ett gratiskonto för att berätta för oss.',
        pace: 'Tempot i ditt senaste spel',
        paceAnswers: ['för långsamt', 'lagom', 'för snabbt'],
        old: 'Jämfört med gamla Pidro',
        oldAnswers: ['sämre', 'samma', 'bättre'],
        close: 'Stäng',
      }
    : {
        door: 'News',
        title: "Hey, I'm Marcel.",
        ask: "What did you notice? If it felt wrong, that's on us, not you.",
        placeholder: 'Write it here, or tap the microphone on your keyboard and say it.',
        reply: "We'll answer at bengt@example.com",
        change: 'Change',
        add: 'Want an answer? Add your email',
        email: 'Your email',
        send: 'Send',
        fine: 'Your app version, phone and last game come along.',
        thanks: 'Thanks. We read every one.',
        after: 'If we answer, it goes to bengt@example.com.',
        done: 'Done',
        failed: "That didn't go through. Your words are safe.",
        retry: 'Try again',
        mailApp: 'Use my mail app',
        limit: "That's plenty for today, thank you. Your words stay here for tomorrow.",
        limitButton: 'Send tomorrow',
        account: 'Create a free account to tell us.',
        chip: 'About your last game',
        pace: 'Pace in your last game',
        paceAnswers: ['too slow', 'right', 'too fast'],
        old: 'Compared to the old Pidro',
        oldAnswers: ['worse', 'same', 'better'],
        thanksShort: 'Thanks',
        more: 'Tell us more ›',
        close: 'Close',
      };

/** The sheet fits the screen without scrolling: Send whole, the card still a place to write. */
async function assertTellSheetFits(page, testCase, viewport) {
  const sheet = page.getByTestId('feedback-sheet');
  const box = await getStableBox(sheet, page);
  assertInsideViewport(`${testCase.name} sheet`, box, viewport);
  const send = await getStableBox(page.getByTestId('feedback-send'), page);
  assertInsideViewport(`${testCase.name} Send`, send, viewport);
  assert.ok(send.height >= 44, `${testCase.name}: Send is a 44pt target`);
  assert.ok(send.y + send.height <= box.y + box.height, `${testCase.name}: Send inside the sheet`);
  const ink = await getStableBox(page.getByTestId('feedback-body'), page);
  assert.ok(ink.height >= 40, `${testCase.name}: the card keeps room to write (${ink.height})`);
  // Phone landscape puts Send in its own column beside the card.
  if (viewport.width > viewport.height && viewport.height < 500)
    assert.ok(ink.x + ink.width <= send.x, `${testCase.name}: the card ends left of Send`);
  else assert.ok(ink.y + ink.height <= send.y, `${testCase.name}: the card ends above Send`);
  const overflow = await sheet.evaluate((node) =>
    [node, ...node.querySelectorAll('*')].some(
      (child) =>
        ['auto', 'scroll'].includes(getComputedStyle(child).overflowY) &&
        child.scrollHeight > child.clientHeight + 2
    )
  );
  assert.equal(overflow, false, `${testCase.name}: the sheet never scrolls`);
}

// PID-316: each Tell us state reads as the boards say, and fits all four sizes.
async function assertTellState(page, testCase, viewport) {
  if (!testCase.tell) return;
  const copy = tellCopy(testCase);
  const sheet = page.getByTestId('feedback-sheet');
  const see = (text, scope = sheet) => scope.getByText(text, { exact: true }).waitFor();
  const state = testCase.tell;
  if (state === 'home') {
    const door = page.getByRole('button', { name: copy.door, exact: true });
    const box = await getStableBox(door, page);
    assert.ok(box.width >= 44 && box.height >= 44, `${testCase.name}: the door is a 44pt target`);
    assertInsideViewport(`${testCase.name} door`, box, viewport);
    const header = await getStableBox(page.getByTestId('home-header'), page);
    assert.ok(
      box.x + box.width <= header.x + header.width + 1,
      `${testCase.name}: door in the bar`
    );
    assert.equal(await door.innerText(), '', `${testCase.name}: the door has no words`);
    if (testCase.authFixture === guestAuthFixture) {
      const gear = await getStableBox(
        page.getByRole('button', { name: 'Settings', exact: true }),
        page
      );
      assert.equal(Math.round(gear.width), Math.round(box.width), 'door and gear, one size');
      assert.equal(Math.round(gear.height), Math.round(box.height), 'door and gear, one size');
      // The name gives way first: it never runs under Friends.
      const name = await getStableBox(page.getByText('Lucky Moose', { exact: true }), page);
      const friends = await getStableBox(
        page.getByRole('button', { name: 'Friends', exact: true }),
        page
      );
      assert.ok(name.x + name.width <= friends.x + 1, `${testCase.name}: the name truncates first`);
    }
    return;
  }
  if (state === 'pace' || state === 'old' || state === 'notice') {
    if (state === 'notice') {
      await page.getByTestId('news-popup').waitFor();
      const ask = page.getByTestId('feedback-ask');
      await ask.waitFor();
      assert.ok(
        await ask.evaluate((el) => {
          const box = el.getBoundingClientRect();
          return !el.contains(
            document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
          );
        }),
        'the popup blocks the feedback question underneath'
      );
      return;
    }
    const card = page.getByTestId('feedback-ask');
    await see(state === 'pace' ? copy.pace : copy.old, card);
    const box = await getStableBox(card, page);
    assertInsideViewport(`${testCase.name} card`, box, viewport);
    const header = await getStableBox(page.getByTestId('home-header'), page);
    const tile = await getStableBox(page.getByTestId('home-quick-game'), page);
    assert.ok(box.y >= header.y + header.height, `${testCase.name}: card below the header`);
    if (viewport.width < viewport.height)
      assert.ok(box.y + box.height <= tile.y, `${testCase.name}: card above the tiles`);
    const radios = card.getByRole('radio');
    assert.deepEqual(
      (await radios.allInnerTexts()).map((label) => label.trim()),
      state === 'pace' ? copy.paceAnswers : copy.oldAnswers
    );
    for (const radio of await radios.all()) {
      const choice = await radio.boundingBox();
      assert.ok(choice.height >= 44, `${testCase.name}: each answer is a 44pt target`);
    }
    return;
  }
  await sheet.waitFor();
  await waitForScreenshotReady(page);
  await see(state === 'sent' ? copy.thanks : copy.title);
  if (state === 'sent') {
    await see(copy.after);
    await sheet.getByRole('button', { name: copy.done, exact: true }).waitFor();
    assertInsideViewport(`${testCase.name} sheet`, await getStableBox(sheet, page), viewport);
    return;
  }
  const landscape = viewport.width > viewport.height && viewport.height < 500;
  if (!(landscape && ['failed', 'limit', 'account'].includes(state))) await see(copy.ask);
  const ink = page.getByTestId('feedback-body');
  assert.equal(await ink.getAttribute('placeholder'), copy.placeholder);
  const words = ['open', 'chip'].includes(state) ? '' : TELL_WORDS;
  assert.equal(await ink.inputValue(), words);
  const send = page.getByTestId('feedback-send');
  const label = state === 'failed' ? copy.retry : state === 'limit' ? copy.limitButton : copy.send;
  assert.equal((await send.innerText()).trim(), label);
  const refused = state === 'limit' || state === 'account';
  assert.equal(
    await send.isDisabled(),
    refused || words === '',
    `${testCase.name}: Send is ${refused || !words ? 'off' : 'on'}`
  );
  if (state === 'guest') {
    assert.equal(await page.getByTestId('feedback-email').inputValue(), 'bengt@example.com');
    await see(copy.email);
    assert.equal(await sheet.getByText(/answer at/).count(), 0, 'no account address to answer at');
  } else if (refused) {
    await see(state === 'limit' ? copy.limit : copy.account);
    assert.equal(await sheet.getByText(copy.reply, { exact: true }).count(), 0);
    assert.equal(await sheet.getByText(copy.failed, { exact: true }).count(), 0);
    assert.equal(await sheet.getByRole('button', { name: copy.mailApp }).count(), 0);
  } else {
    await see(copy.reply);
    await sheet.getByRole('button', { name: copy.change, exact: true }).waitFor();
  }
  if (state === 'failed') {
    await see(copy.failed);
    await sheet.getByRole('button', { name: copy.mailApp, exact: true }).waitFor();
  }
  if (state === 'chip') await see(copy.chip);
  if (state === 'open' && !landscape) await see(copy.fine);
  // No suit symbols and no photo anywhere on it.
  assert.equal(await sheet.locator('img').count(), 0, `${testCase.name}: no photo`);
  assert.doesNotMatch(await sheet.innerText(), /[♠♥♦♣]/u);
  await assertTellSheetFits(page, testCase, viewport);
}

/** Taps through the door, the question card and the send, against the routed server. */
async function assertTellInteractions(page, testCase, viewport) {
  if (!testCase.tell || testCase.tellLocale) return;
  const copy = tellCopy(testCase);
  const sheet = page.getByTestId('feedback-sheet');
  // PID-347: Tell us is the first row in News.
  const door = {
    click: async () => {
      if (!(await page.getByTestId('news-sheet').count()))
        await page.getByRole('button', { name: copy.door, exact: true }).click();
      await page.getByTestId('news-tell').click();
    },
  };
  const close = () => sheet.getByRole('button', { name: copy.close, exact: true }).first().click();
  const state = testCase.tell;
  if (state === 'home' && testCase.authFixture === guestAuthFixture) {
    // PID-348: a guest reads News, with no Tell us and no Write back.
    await page.getByRole('button', { name: copy.door, exact: true }).click();
    await page.getByTestId('news-sheet').waitFor();
    assert.equal(await page.getByTestId('news-tell').count(), 0, 'no Tell us for a guest');
    assert.equal(await page.getByRole('button', { name: /^Write back/ }).count(), 0);
    return;
  }
  if (state === 'home') {
    await door.click();
    await sheet.waitFor();
    // The sheet lands first, then the box takes focus.
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('data-testid') === 'feedback-body'
    );
    await close();
    await sheet.waitFor({ state: 'detached' });
    return;
  }
  if (state === 'pace') {
    const card = page.getByTestId('feedback-ask');
    const before = await getStableBox(card, page);
    const slow = card.getByRole('radio', { name: copy.paceAnswers[0] });
    await slow.click();
    assert.equal(await slow.getAttribute('aria-checked'), 'true', 'marked in place');
    await card.getByText(copy.old, { exact: true }).waitFor();
    await card.getByRole('radio', { name: copy.oldAnswers[2] }).click();
    await card.getByText(copy.thanksShort, { exact: true }).waitFor();
    const after = await getStableBox(card, page);
    assert.ok(Math.abs(after.y - before.y) <= 1, 'nothing jumps: the card holds its place');
    assert.ok(
      Math.abs(after.height - before.height) <= 1,
      'nothing jumps: the card holds its size'
    );
    assert.deepEqual(page.tellPosts, [
      { kind: 'pace', answer: 'too_slow', game_id: 'fixture-game' },
      { kind: 'old_pidro', answer: 'better', game_id: 'fixture-game' },
    ]);
    await card.getByRole('button', { name: copy.more, exact: true }).click();
    await sheet.getByText(copy.chip, { exact: true }).waitFor();
    await close();
    await sheet.waitFor({ state: 'detached' });
    // Closing the thanks only hides it: the answers stand, no skip follows them.
    await card.getByRole('button', { name: copy.close, exact: true }).click();
    await card.waitFor({ state: 'detached' });
    await page.waitForTimeout(500);
    assert.deepEqual(page.tellPosts, [
      { kind: 'pace', answer: 'too_slow', game_id: 'fixture-game' },
      { kind: 'old_pidro', answer: 'better', game_id: 'fixture-game' },
    ]);
    return;
  }
  if (state === 'old') {
    const card = page.getByTestId('feedback-ask');
    await card.getByRole('button', { name: copy.close, exact: true }).click();
    await card.waitFor({ state: 'detached' });
    assert.deepEqual(page.tellPosts, [
      { kind: 'old_pidro', answer: 'skipped', game_id: 'fixture-game' },
    ]);
    return;
  }
  if (state === 'failed') {
    // No mail app either: the address is there to write to.
    await page.evaluate(() => {
      window.open = () => {
        throw new Error('no mail app');
      };
    });
    await sheet.getByRole('button', { name: copy.mailApp, exact: true }).click();
    await sheet.getByText('marcel@pidro.online', { exact: true }).waitFor();
    return;
  }
  if (state === 'open') {
    // Change folds down the address to edit; an empty one still sends.
    await sheet.getByRole('button', { name: copy.change, exact: true }).click();
    const email = page.getByTestId('feedback-email');
    assert.equal(await email.inputValue(), 'bengt@example.com');
    await email.fill('');
    await page.getByTestId('feedback-body').fill('Too fast for me.');
    await page.getByTestId('feedback-send').click();
    await sheet.getByText(copy.thanks, { exact: true }).waitFor();
    await sheet
      .getByText("You left no email, so we can't answer this one.", { exact: true })
      .waitFor();
    assert.equal(page.tellPosts.length, 1);
    assert.equal(page.tellPosts[0].reply_email, undefined, 'no address, none sent');
    return;
  }
  if (state === 'send') {
    const frames = process.env.TELL_FRAMES_DIR;
    const shoot = (name) =>
      frames ? page.screenshot({ path: resolve(frames, `${name}.png`) }) : undefined;
    if (frames) await mkdir(frames, { recursive: true });
    await shoot('0-typed');
    const send = page.getByTestId('feedback-send');
    await send.click();
    const started = Date.now();
    for (const [at, name] of [
      [120, '1-turning'],
      [600, '2-face-down'],
      [1100, '3-still-face-down'],
    ]) {
      await page.waitForTimeout(Math.max(0, at - (Date.now() - started)));
      await shoot(name);
    }
    // Face down while the note travels: no spinner, the words put away.
    assert.equal(await sheet.getByRole('progressbar').count(), 0, 'no spinner');
    assert.equal(await page.getByTestId('feedback-body').isEditable(), false);
    await page.waitForTimeout(Math.max(0, 1380 - (Date.now() - started)));
    await shoot('4-leaving');
    await sheet.getByText(copy.thanks, { exact: true }).waitFor();
    await sheet.getByText(copy.after, { exact: true }).waitFor();
    await page.waitForTimeout(300);
    await shoot('5-thanks');
    const [note] = page.tellPosts;
    assert.equal(note.kind, 'note');
    assert.equal(note.body, TELL_WORDS);
    assert.equal(note.reply_email, 'bengt@example.com');
    assert.equal(note.details.platform, 'web');
    await sheet.getByRole('button', { name: copy.done, exact: true }).click();
    await sheet.waitFor({ state: 'detached' });
    await door.click();
    assert.equal(await page.getByTestId('feedback-body').inputValue(), '', 'sent words are gone');
    return;
  }
  if (state === 'send-fails') {
    // Typed, so the words are the draft that outlives this sheet: Tell us opens again from News.
    await page.getByTestId('feedback-body').fill('');
    await page.getByTestId('feedback-body').fill(TELL_WORDS);
    await page.getByTestId('feedback-send').click();
    await sheet.getByText(copy.failed, { exact: true }).waitFor();
    assert.equal(await page.getByTestId('feedback-body').inputValue(), TELL_WORDS);
    assert.equal((await page.getByTestId('feedback-send').innerText()).trim(), copy.retry);
    await assertTellSheetFits(page, testCase, viewport);
    // Closing keeps the words for next time.
    await close();
    await sheet.waitFor({ state: 'detached' });
    await door.click();
    assert.equal(await page.getByTestId('feedback-body').inputValue(), TELL_WORDS);
  }
}

const NEWS_TITLES = [
  'The table sounds like Pidro again',
  'Bigger cards, a calmer table',
  'Welcome to the new Pidro',
];

async function assertNewsPopup(page, { popup, locale, name }, viewport) {
  const card = page.getByTestId('news-popup');
  await card.waitFor();
  await waitForScreenshotReady(page);
  await assertAccountSurfaceFits(card, name, viewport);
  const box = await getStableBox(card, page);
  assertInsideViewport(name, box, viewport);
  assert.ok(Math.abs(box.y + box.height / 2 - viewport.height / 2) < 2, 'card is centred');
  const sv = locale === 'sv';
  const update = !['news', 'link'].includes(popup);
  const label = update
    ? `${sv ? 'Uppdatera i' : 'Update in'} ${popup === 'ios' ? 'TestFlight' : 'Google Play'}`
    : popup === 'link'
      ? sv
        ? 'Läs mer'
        : 'Read more'
      : sv
        ? 'Okej'
        : 'Got it';
  const action = page.getByTestId('news-popup-action');
  assert.equal(await action.getAttribute('aria-label'), label);
  assert.equal(await card.getByRole('button').count(), update ? 2 : 1);
  for (const button of await card.getByRole('button').all()) {
    const target = await getStableBox(button, page);
    assert.ok(target.width >= 44 && target.height >= 44, 'popup actions are 44pt targets');
  }
  const body = page.getByTestId('news-popup-body');
  assert.doesNotMatch(await body.innerText(), /\*\*/);
  const bold = body.getByText(
    update
      ? sv
        ? 'du får tillbaka din plats'
        : 'you get your seat back'
      : sv
        ? 'precis som förr'
        : 'just like before',
    { exact: true }
  );
  assert.equal(await bold.evaluate((el) => getComputedStyle(el).fontWeight), '900');
  assert.doesNotMatch((await card.innerText()).replace(label, ''), /\bstore\b|TestFlight|!/i);
  // PID-415: update cards name both builds (fixture 14 and 19); news has no line.
  const builds = card.getByTestId('news-popup-builds');
  assert.equal(await builds.count(), update ? 1 : 0);
  if (update)
    assert.equal(
      await builds.innerText(),
      sv
        ? 'Du har byggnummer 14 · det här är byggnummer 19'
        : 'You have build 14 · this is build 19'
    );
  const image = card.getByTestId('news-popup-image');
  assert.equal(await image.count(), ['image', 'news'].includes(popup) ? 1 : 0);
  if (await image.count())
    assert.ok(
      await image.locator('img').evaluate((el) => el.complete && el.naturalWidth > 0),
      'image loaded'
    );
  assert.equal(await page.getByTestId('update-notice').count(), 0);
}

// PID-347: the News door and the Friends tab's count on Home, and every state of the sheet.
async function assertNewsState(page, testCase, viewport) {
  const state = testCase.news;
  if (!state) return;
  if (state === 'home' || state === 'request') {
    const red = state === 'request';
    const door = page.getByRole('button', {
      name: red ? 'News' : 'News, new posts',
      exact: true,
    });
    const box = await getStableBox(door, page);
    assert.ok(box.width >= 44 && box.height >= 44, `${testCase.name}: the door is a 44pt target`);
    assertInsideViewport(`${testCase.name} door`, box, viewport);
    if (red) assert.equal(await page.getByTestId('home-news-dot').count(), 0, 'nothing new');
    else {
      const dot = await getStableBox(page.getByTestId('home-news-dot'), page);
      assert.ok(
        dot.x + dot.width > box.x + box.width - 8 && dot.y < box.y + 8,
        `${testCase.name}: the dot sits on the door's top-right corner`
      );
      assertInsideViewport(`${testCase.name} dot`, dot, viewport);
    }
    assert.equal(await page.getByTestId('home-waiting-count').count(), 0, 'no count on the face');
    const badge = page.getByTestId(red ? 'friends-invitation-count' : 'friends-online-count');
    assert.equal((await badge.innerText()).trim(), red ? '1' : '2');
    assert.equal(
      await page.getByTestId(red ? 'friends-online-count' : 'friends-invitation-count').count(),
      0,
      `${testCase.name}: one count on the tab`
    );
    const tab = page.getByRole('button', {
      name: red ? 'Friends, 1 waiting for your answer' : 'Friends, 2 online now',
      exact: true,
    });
    const label = await getStableBox(tab.getByText('Friends', { exact: true }), page);
    const count = await getStableBox(badge, page);
    assert.ok(!boxesOverlap(label, count), `${testCase.name}: the count clears the tab's label`);
    assertInsideViewport(`${testCase.name} count`, count, viewport);
    return;
  }
  if (state === 'reply') {
    const sheet = page.getByTestId('feedback-sheet');
    await sheet.getByText(NEWS_TITLES[0], { exact: true }).waitFor();
    assertInsideViewport(`${testCase.name} sheet`, await getStableBox(sheet, page), viewport);
    return;
  }
  const sheet = page.getByTestId('news-sheet');
  const box = await getStableBox(sheet, page);
  assertInsideViewport(`${testCase.name} sheet`, box, viewport);
  // Nearly the full height, so the list has room to scroll.
  assert.ok(
    box.height >= Math.min(viewport.height * 0.75, 820),
    `${testCase.name}: the sheet is ${box.height} tall`
  );
  await sheet.getByText('News', { exact: true }).waitFor();
  const close = await getStableBox(sheet.getByRole('button', { name: 'Close', exact: true }), page);
  assert.ok(close.width >= 44 && close.height >= 44, `${testCase.name}: Close is a 44pt target`);
  const posts = page.getByTestId('news-post');
  const feed = page.getByTestId('news-feed');
  if (testCase.authFixture === guestAuthFixture) {
    assert.equal(await page.getByTestId('news-tell').count(), 0, 'no Tell us for a guest');
    assert.equal(await sheet.getByRole('button', { name: /^Write back/ }).count(), 0);
    assert.equal(await posts.count(), 3);
    await feed.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    assertInsideViewport(
      `${testCase.name} last post`,
      await getStableBox(posts.nth(2), page),
      viewport
    );
    await feed.evaluate((node) => {
      node.scrollTop = 0;
    });
    return;
  }
  const tell = await getStableBox(page.getByTestId('news-tell'), page);
  assert.ok(tell.height >= 44, `${testCase.name}: Tell us is a 44pt target`);
  await page.getByTestId('news-tell').getByText('Something off, or something you love?').waitFor();
  if (state !== 'sheet') {
    assert.equal(await posts.count(), 0, `${testCase.name}: no posts`);
    const failed = await sheet.getByText("News didn't load.", { exact: true }).count();
    assert.equal(failed, state === 'error' ? 1 : 0, `${testCase.name}: the error only on error`);
    if (state === 'error') await sheet.getByRole('button', { name: 'Try again' }).waitFor();
    return;
  }
  assert.equal(await posts.count(), 3);
  for (const [index, title] of NEWS_TITLES.entries())
    await posts.nth(index).getByText(title, { exact: true }).waitFor();
  // PID-407: the newest post's image tops its card; a broken one goes and leaves no gap.
  const image = posts.nth(0).getByTestId('news-post-image');
  await image.locator('img').waitFor({ state: 'attached' });
  await page.waitForFunction(
    (el) => el.complete && el.naturalWidth > 0,
    await image.locator('img').elementHandle()
  );
  await posts.nth(2).getByTestId('news-post-image').waitFor({ state: 'detached' });
  assert.equal(await posts.nth(1).getByTestId('news-post-image').count(), 0);
  const titleTop = async (index) =>
    (await getStableBox(posts.nth(index).getByRole('heading'), page)).y -
    (await getStableBox(posts.nth(index), page)).y;
  const imageTop =
    (await getStableBox(image, page)).y - (await getStableBox(posts.first(), page)).y;
  assert.ok(imageTop < 20 && (await titleTop(0)) > 180, `${testCase.name}: the image on top`);
  assert.equal(await titleTop(2), await titleTop(1), `${testCase.name}: no gap for a broken image`);
  assert.equal(await page.getByTestId('news-post-new').count(), 2, 'the two new posts keep a dot');
  assert.equal(await posts.nth(2).getByTestId('news-post-new').count(), 0);
  await posts.nth(0).getByText('Today', { exact: true }).waitFor();
  // The welcome keeps its line breaks.
  const welcome = await posts.nth(2).innerText();
  assert.match(welcome, /still being built\.\nHere today/);
  const tellRow = await getStableBox(page.getByTestId('news-tell'), page);
  const first = await getStableBox(posts.first(), page);
  assert.ok(tellRow.y + tellRow.height <= first.y, `${testCase.name}: Tell us comes first`);
  for (const button of await sheet.getByRole('button', { name: /^Write back/ }).all()) {
    const target = await button.boundingBox();
    assert.ok(target.height >= 44, `${testCase.name}: Write back is a 44pt target`);
  }
  // The list scrolls inside the sheet rather than run past it.
  // On phones the three posts run past the sheet; an iPad holds them all.
  const scrolls = await feed.evaluate((node) => node.scrollHeight > node.clientHeight + 2);
  if (Math.min(viewport.width, viewport.height) < 700)
    assert.ok(scrolls, `${testCase.name}: the posts scroll`);
  await feed.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const lastWriteBack = await getStableBox(
    sheet.getByRole('button', { name: `Write back: ${NEWS_TITLES[2]}`, exact: true }),
    page
  );
  assertInsideViewport(`${testCase.name} last Write back`, lastWriteBack, viewport);
  await feed.evaluate((node) => {
    node.scrollTop = 0;
  });
}

/** Write back answers the post, and Done lands back in News. */
async function assertNewsInteractions(page, testCase, viewport) {
  if (testCase.name !== 'news-sheet' || viewport.name !== 'portrait') return;
  const tell = page.getByTestId('feedback-sheet');
  await page.getByRole('button', { name: `Write back: ${NEWS_TITLES[0]}`, exact: true }).click();
  await tell.getByText(NEWS_TITLES[0], { exact: true }).waitFor();
  await page.getByTestId('feedback-body').fill('Lovely to hear the shuffle again.');
  await page.getByTestId('feedback-send').click();
  await tell.getByRole('button', { name: 'Done', exact: true }).click();
  await tell.waitFor({ state: 'detached' });
  await page.getByTestId('news-sheet').waitFor();
  assert.equal(page.tellPosts.length, 1);
  assert.equal(page.tellPosts[0].news_post_id, 3, 'the note answers the sounds post');
  assert.equal(page.tellPosts[0].body, 'Lovely to hear the shuffle again.');
  // Tell us from the row is a plain note.
  await page.getByTestId('news-tell').click();
  await tell.waitFor();
  assert.equal(await tell.getByText(NEWS_TITLES[0], { exact: true }).count(), 0, 'no chip');
}

// Visible copy only: card accessibility labels may still name their symbol.
async function assertLeagueSymbolCopy(surface) {
  assert.doesNotMatch(
    await surface.innerText(),
    /\b(?:room|rooms|grupp\w*|tier|tiers|Deuce|Ten|Jack|Ace|Pidro|Tvåa|Tia|Knekt|Ess|rummet|rummets|rum|nivå)\b/iu,
    'league surfaces use card symbols, never room/tier text or rendered card names'
  );
  const cards = await surface
    .locator('[aria-label]:not([role="button"]):not([role="link"])')
    .allTextContents();
  for (const card of cards.filter((copy) => /[♥♠♦♣]/u.test(copy))) {
    assert.match(card.replace(/\s/gu, ''), /^(?:2|10|J|A|5)♥$/u, 'league cards are hearts');
  }
}

async function assertLeagueDividers(page, room, locale) {
  const list = page.getByTestId('league-list');
  const originalOffset = await list.evaluate((node) => node.scrollTop);
  assert.equal(await page.getByTestId('league-demotion').count(), 0, 'no demotion footer');
  for (const [direction, place] of [
    ['up', room.promote || null],
    ['down', room.demote ? room.size - room.demote + 1 : null],
  ]) {
    const divider = page.getByTestId(`league-${direction}-divider`);
    assert.equal(await divider.count(), place ? 1 : 0, `${direction} band follows server counts`);
    if (!place) continue;
    await divider.scrollIntoViewIfNeeded();
    await waitForScreenshotReady(page);
    const box = await divider.boundingBox();
    const row = await list.getByTestId(`league-row-${place}`).boundingBox();
    const text =
      locale === 'sv'
        ? direction === 'up'
          ? '↑ Flytta upp'
          : '↓ Flytta ner'
        : direction === 'up'
          ? '↑ Move up'
          : '↓ Move down';
    assert.ok((await divider.innerText()).includes(text), `${direction} divider has exact label`);
    assert.ok(await divider.locator('[aria-label]').count(), 'divider includes a card');
    assert.ok(!boxesOverlap(box, row), `${direction} divider never overlaps its boundary row`);
    assert.ok(
      Math.abs(direction === 'up' ? box.y - row.y - row.height : row.y - box.y - box.height) <= 4,
      direction === 'up'
        ? 'up divider AFTER last promoted row'
        : 'down divider BEFORE first demoted row'
    );
    const neighbor = list.getByTestId(`league-row-${direction === 'up' ? place + 1 : place - 1}`);
    if (await neighbor.count()) {
      const neighborBox = await neighbor.boundingBox();
      assert.ok(
        !boxesOverlap(box, neighborBox),
        `divider clears both adjacent rows: ${JSON.stringify({ direction, box, row, neighborBox })}`
      );
    }
    const pinned = page.getByTestId('league-pinned');
    if (await pinned.count()) {
      const bounds = await list.boundingBox();
      assert.ok(
        bounds.y + bounds.height <= (await pinned.boundingBox()).y + 1,
        'both divider bands remain in the list, clear of the pinned footer'
      );
    }
  }
  await list.evaluate((node, offset) => (node.scrollTop = offset), originalOffset);
  await waitForScreenshotReady(page);
}

async function assertLeague(page, testCase, viewport) {
  const state = testCase.league;
  const root = page.getByTestId(testCase.testId);
  assertInsideViewport(testCase.name, await root.boundingBox(), viewport);
  assert.equal(await page.getByTestId('league-intro').count(), 0, 'intro is never presented');
  if (state.startsWith('game-')) {
    const change = state.slice(5);
    const eligible = ['up', 'down', 'same', 'new', 'delayed'].includes(change);
    const human = !['guest', 'solo', 'crew'].includes(change);
    const slot = page.getByTestId('game-over-league-slot');
    const line = page.getByTestId('game-over-league');
    assert.equal(await slot.count(), human ? 1 : 0, 'human seated viewers reserve a league slot');
    assert.equal(await line.count(), eligible ? 1 : 0, 'only eligible games show league progress');
    if (eligible) {
      const sv = testCase.locale === 'sv';
      const place = change === 'down' ? 7 : change === 'same' ? 6 : change === 'new' ? 12 : 5;
      const arrow = change === 'down' ? ' ↓' : ['up', 'delayed'].includes(change) ? ' ↑' : '';
      const expected = `${change === 'new' ? (sv ? 'Du är med på listan' : 'You’re on the board') : '+20'} · ${place}${sv ? ':e den här veckan' : 'th this week'}${arrow}`;
      await line.getByText(expected, { exact: true }).waitFor();
      await assertLeagueSymbolCopy(line);
      const copy = line.getByText(expected, { exact: true });
      const geometry = await copy.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          height: node.getBoundingClientRect().height,
          lineHeight: parseFloat(style.lineHeight),
          clipped: node.scrollWidth > node.clientWidth + 1,
        };
      });
      assert.ok(geometry.height <= geometry.lineHeight + 1, 'postgame league copy stays one line');
      assert.equal(geometry.clipped, false, 'postgame league copy is not ellipsized');
      const box = await line.boundingBox();
      for (const id of ['rematch-status', 'play-again', 'game-over-home', 'xp-chip']) {
        const control = page.getByTestId(id);
        await control.waitFor();
        assert.ok(!boxesOverlap(box, await control.boundingBox()), `league line clears ${id}`);
      }
      const insets = testCase.leagueInsets;
      if (insets) {
        const safe = {
          left: insets === 'island-left' ? 59 : 0,
          right: insets === 'island-right' ? 59 : 0,
          top: insets === 'island' ? 59 : insets === 'android-gesture' ? 24 : 0,
          bottom: insets === 'island' ? 34 : insets === 'android-gesture' ? 24 : 21,
        };
        for (const id of ['game-over-league', 'play-again', 'game-over-home']) {
          const control = await page.getByTestId(id).boundingBox();
          assert.ok(
            control.x >= safe.left && control.x + control.width <= viewport.width - safe.right
          );
          assert.ok(
            control.y >= safe.top && control.y + control.height <= viewport.height - safe.bottom
          );
        }
      }
    }
    if (human) {
      await page.getByTestId('rematch-status').waitFor();
      assert.equal(await page.getByTestId('rematch-seat').count(), 3);
      assert.equal(await page.getByTestId('play-again').isEnabled(), true);
    }
    if (change === 'delayed') {
      const evidence = await page.evaluate(() => window.__leagueDelay);
      assert.ok(
        evidence?.before && evidence?.after,
        'captured real button boxes before/after data'
      );
      for (const id of ['play-again', 'game-over-home']) {
        for (const key of ['x', 'y', 'width', 'height']) {
          assert.ok(
            Math.abs(evidence.before[id][key] - evidence.after[id][key]) <= 1,
            `${id} ${key} stays put when delayed league progress arrives`
          );
        }
      }
    }
    return;
  }
  if (state.startsWith('sample-')) {
    const sample = JSON.parse(
      await readFile(
        resolve(mobileRoot, `src/features/leagueSamples/${state.slice(7)}.json`),
        'utf8'
      )
    );
    if (sample.pending_result && sample.pending_result.move !== 'stayed') {
      const result = page.getByTestId('league-result');
      await result.waitFor();
      await page.waitForTimeout(400);
      await assertAccountSurfaceFits(result, testCase.name, viewport);
      await page.getByTestId('league-result-backdrop').click({ position: { x: 2, y: 2 } });
      await result.waitFor({ state: 'detached' });
    }
    assert.equal(await page.getByTestId('league-result').count(), 0, 'stayed never shows a sheet');
    await assertLeagueSymbolCopy(root);
    if (sample.room) await assertLeagueDividers(page, sample.room, testCase.locale);
    await assertMinimumTouchTargets(page, testCase.testId, viewport);
    return;
  }
  if (state.startsWith('settings-')) {
    const row = page.getByTestId('settings-league');
    if (state === 'settings-guest' || state === 'settings-off') {
      assert.equal(await row.count(), 0, 'no league switch for guests or disabled leagues');
      return;
    }
    await row.scrollIntoViewIfNeeded();
    assertInsideViewport('league preference', await row.boundingBox(), viewport);
    const toggle = row.getByRole('switch');
    assert.equal(await toggle.getAttribute('aria-checked'), String(state === 'settings-hidden'));
    const box = await toggle.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, 'league switch has a 44pt target');
    if (state === 'settings-confirm' || state === 'settings-failed') {
      await toggle.click();
      const confirm = page.getByTestId('league-hide-confirm');
      await confirm.waitFor();
      await page.waitForTimeout(400);
      await assertAccountSurfaceFits(confirm.locator('..'), testCase.name, viewport);
      await mkdir(resolve(screenshotRoot, viewport.name), { recursive: true });
      await page.screenshot({
        path: resolve(screenshotRoot, viewport.name, `${testCase.name}-dialog.png`),
      });
      await page
        .getByRole('link', { name: testCase.locale === 'sv' ? 'Avbryt' : 'Cancel', exact: true })
        .click();
      assert.equal(await toggle.getAttribute('aria-checked'), 'false', 'cancel keeps membership');
      await toggle.click();
      const hide = confirm.getByRole('button', {
        name: testCase.locale === 'sv' ? 'Dölj mig i ligorna' : 'Hide me from leagues',
        exact: true,
      });
      if (state === 'settings-failed') {
        await hide.click();
        await confirm.getByRole('alert').waitFor();
        assert.equal(
          await toggle.getAttribute('aria-checked'),
          'false',
          'failed PUT keeps membership'
        );
        await assertAccountSurfaceFits(confirm.locator('..'), testCase.name, viewport);
      } else {
        await hide.click();
        await confirm.waitFor({ state: 'detached' });
        await page.waitForFunction(
          () =>
            document
              .querySelector('[data-testid="settings-league"] [role="switch"]')
              ?.getAttribute('aria-checked') === 'true'
        );
        await toggle.click();
        await page.waitForFunction(
          () =>
            document
              .querySelector('[data-testid="settings-league"] [role="switch"]')
              ?.getAttribute('aria-checked') === 'false'
        );
      }
    }
    return;
  }
  if (state === 'rules') {
    await assertLeagueSymbolCopy(root);
    assert.equal(await page.getByTestId('league-rules').count(), 0, 'rules are optional');
    await page.getByTestId('league-info').click();
    const rules = page.getByTestId('league-rules');
    await rules.waitFor();
    await page.waitForTimeout(400);
    await assertAccountSurfaceFits(rules, testCase.name, viewport);
    const swedish = testCase.locale === 'sv';
    const paragraphs = swedish
      ? [
          'Varje parti du spelar med andra ger poäng. Partier med bara botar räknas inte.',
          'Varje vecka möter du ungefär 30 spelare på din nivå.',
          'På söndag kväll flyttar de bästa spelarna upp ett kort och de sista flyttar ner.',
          'Ditt bästa kort varje månad visas på din profil.',
        ]
      : [
          'Every game you play with other people earns points. Games with only bots don’t count.',
          'Each week you’re up against about 30 players at your level.',
          'On Sunday evening the top players move up a card and the bottom ones move down.',
          'Your best card each month shows on your profile.',
        ];
    const names = swedish
      ? ['Tvåa', 'Tia', 'Knekt', 'Ess', 'Pidro']
      : ['Deuce', 'Ten', 'Jack', 'Ace', 'Pidro'];
    for (const text of [...names, ...paragraphs]) {
      assert.equal(await rules.getByText(text, { exact: true }).count(), 1, `rules: ${text}`);
    }
    assert.equal(
      await rules.locator('[aria-label]:not([role="button"]):not([role="link"])').count(),
      5,
      'five named cards'
    );
    assert.deepEqual(
      (
        await rules
          .locator('[aria-label]:not([role="button"]):not([role="link"])')
          .allTextContents()
      ).map((copy) => copy.replace(/\s/gu, '')),
      ['2♥', '10♥', 'J♥', 'A♥', '5♥'],
      'the five league cards are heart ranks in order'
    );
    // Lock the complete copy: no extra paragraphs, descriptions or Classic plaque.
    const copy = await rules.evaluate((node) => {
      const clone = node.cloneNode(true);
      clone
        .querySelectorAll('[aria-label]:not([role="button"]):not([role="link"])')
        .forEach((card) => card.remove());
      return clone.textContent;
    });
    assert.equal(
      copy.replace(/\s+/gu, ''),
      [swedish ? 'Liga' : 'League', ...names, ...paragraphs, swedish ? 'Stäng' : 'Close']
        .join('')
        .replace(/\s+/gu, '')
    );
    assert.equal(
      await rules.evaluate((node) =>
        [...node.querySelectorAll('*')].some(
          (child) =>
            ['auto', 'scroll'].includes(getComputedStyle(child).overflowY) &&
            child.scrollHeight > child.clientHeight + 2
        )
      ),
      false,
      'rules fit without scrolling at all four standard sizes'
    );
    await assertMinimumTouchTargets(page, 'league-rules', viewport);
    return;
  }
  if (state === 'result-stayed' || state === 'result-stayed-host') {
    if (state === 'result-stayed-host') {
      await page.waitForFunction(() => window.__leagueStayedAck === true);
      assert.equal(page.leagueSeenPosts.length, 1, 'real Host silently acknowledges once');
    }
    assert.equal(await page.getByTestId('league-result').count(), 0, 'stayed stays invisible');
    assert.equal(
      await page.getByTestId('league-result-backdrop').count(),
      0,
      'no invisible modal blocks Home'
    );
    assert.equal(
      await page.evaluate(() => window.__leagueStayedFlashed),
      false,
      'stayed never flashes a result'
    );
    return;
  }
  if (state.startsWith('result-')) {
    // Reanimated's 350ms card entry is not a browser CSS transition.
    await page.waitForTimeout(400);
    await assertAccountSurfaceFits(root, testCase.name, viewport);
    const swedish = testCase.locale === 'sv';
    const up = state === 'result-up';
    const heading = swedish
      ? up
        ? 'Du flyttade upp!'
        : 'Du flyttade ner'
      : up
        ? 'You moved up!'
        : 'You moved down';
    const place = swedish ? `${up ? '5:e' : '27:e'} av 30` : `${up ? '5th' : '27th'} of 30`;
    const label = swedish ? 'Fortsätt' : 'Continue';
    for (const text of [heading, place, label])
      assert.equal(await root.getByText(text, { exact: true }).count(), 1);
    const copy = await root.evaluate((node) => {
      const clone = node.cloneNode(true);
      clone
        .querySelectorAll('[aria-label]:not([role="button"]):not([role="link"])')
        .forEach((card) => card.remove());
      return clone.textContent;
    });
    assert.equal(
      copy.replace(/\s+/gu, ''),
      [heading, place, label].join('').replace(/\s+/gu, ''),
      'only movement, ordinal of room size and Continue; no date, ribbon, star or promise'
    );
    assert.equal(await root.getByRole('button').count(), 1, 'Continue is the only result action');
    assert.equal(await root.getByTestId('league-result-continue').innerText(), label);
    assert.equal(
      await root.locator('[aria-label]:not([role="button"]):not([role="link"])').count(),
      2,
      'old and new card only'
    );
    assert.equal(await page.getByTestId('league-result-close').count(), 0, 'no Close action');
    assert.equal(await root.getByTestId('league-ribbon').count(), 0);
    await assertLeagueSymbolCopy(root);
    await assertMinimumTouchTargets(page, testCase.testId, viewport);
    return;
  }
  if (state.startsWith('ribbons-')) {
    const shelf = page.getByTestId('profile-ribbons');
    await shelf.evaluate((node) => node.scrollIntoView({ block: 'center' }));
    assert.ok(
      !boxesOverlap(await shelf.boundingBox(), await page.getByTestId('tab-pill').boundingBox()),
      'the complete ribbon shelf can scroll clear of the pill'
    );
    assert.equal(await shelf.getByTestId('league-ribbon').count(), 12);
    assert.equal(await shelf.getByTestId('league-ribbon-star').count(), 4);
    if (state === 'ribbons-expanded') {
      await shelf.click();
      const history = page.getByTestId('league-ribbons');
      await history.waitFor();
      await assertAccountSurfaceFits(history, testCase.name, viewport);
      assert.equal(await history.locator(':scope > div').count(), 12);
    }
    return;
  }
  if (testCase.homeTick) {
    const place = testCase.homeTick === 'up' ? 5 : 7;
    const arrow = testCase.homeTick === 'up' ? '↑' : '↓';
    const caption = `${place}${testCase.locale === 'sv' ? ':e den här veckan' : 'th this week'}`;
    const tick = page.getByTestId('home-league-tick');
    // RN Animated changes the caption mid-tick, outside the CSS animation readiness check.
    await page.waitForFunction(
      (expected) => {
        const node = document.querySelector('[data-testid="home-league-tick"]');
        if (!node || node.textContent.replace(/\s/gu, '') !== expected) return false;
        const style = getComputedStyle(node);
        return (
          Number(style.opacity) === 1 &&
          (style.transform === 'none' || new DOMMatrix(style.transform).m42 === 0)
        );
      },
      `${caption}${arrow}`.replace(/\s/gu, ''),
      { timeout: 5000 }
    );
    assert.equal(
      (await tick.innerText()).replace(/\s/gu, ''),
      `${caption}${arrow}`.replace(/\s/gu, '')
    );
    const samples = await page.evaluate(() => window.__leagueTickSamples);
    assert.ok(samples?.length, 'Home tick was sampled from first render');
    if (testCase.reducedMotion) {
      assert.ok(
        samples.every(({ opacity, y }) => opacity === 1 && y === 0),
        'reduced motion never animates'
      );
    } else {
      assert.ok(
        samples.some(({ text }) => text.includes('6th') || text.includes('6:e')),
        'old sixth place appears before the new place'
      );
      assert.ok(
        samples.some(({ opacity }) => opacity < 0.99),
        'rank change animates once'
      );
      const pulses = samples.filter(
        ({ opacity }, index) =>
          opacity < 0.99 && (index === 0 || samples[index - 1].opacity >= 0.99)
      );
      assert.equal(pulses.length, 1, 'old-to-new movement has exactly one animation pulse');
    }
    const key = 'league-home:v1:ui-grammar-user';
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    assert.equal(saved.place, place, 'new place persisted');
    assert.equal(saved.week, '2026-11-01T19:00:00Z');
    await page.screenshot({
      path: resolve(screenshotRoot, viewport.name, `${testCase.name}-first-change.png`),
    });
    await page.reload();
    await page.getByTestId('home-league-tick').getByText(caption, { exact: true }).waitFor();
    await page.waitForTimeout(400);
    assert.doesNotMatch(await tick.innerText(), /[↑↓]/u, 'reload never repeats the movement arrow');
    const reloaded = await page.evaluate(() => window.__leagueTickSamples);
    assert.ok(
      reloaded.every(({ opacity, y }) => opacity === 1 && y === 0),
      'reload never repeats the tick animation'
    );
    await assertLeagueSymbolCopy(page.getByTestId('home-league'));
    return;
  }
  if (state.startsWith('home-')) {
    const visible = ['home-placed', 'home-not_placed'].includes(state);
    assert.equal(await page.getByTestId('home-league').count(), visible ? 1 : 0);
    if (visible) {
      const card = page.getByTestId('home-league');
      const caption =
        state === 'home-placed'
          ? testCase.locale === 'sv'
            ? '6:e den här veckan'
            : '6th this week'
          : testCase.locale === 'sv'
            ? 'Spela ett parti med andra för att komma med på listan'
            : 'Play a game with people to get on the board';
      assert.equal(await card.getByText(caption, { exact: true }).count(), 1);
      assert.equal(
        await card.locator('[aria-label]:not([role="button"]):not([role="link"])').count(),
        1,
        'Home shows a card'
      );
      await assertLeagueSymbolCopy(card);
      assertInsideViewport(
        'Home league card',
        await page.getByTestId('home-league').boundingBox(),
        viewport
      );
    }
    return;
  }
  if (state === 'profile' || state === 'profile-not-placed') {
    const link = page.getByTestId('profile-league');
    const cell = link.locator('../..');
    await cell.evaluate((node) => node.scrollIntoView({ block: 'center' }));
    const caption =
      state === 'profile'
        ? testCase.locale === 'sv'
          ? '6:e den här veckan'
          : '6th this week'
        : testCase.locale === 'sv'
          ? 'Spela ett parti med andra för att komma med på listan'
          : 'Play a game with people to get on the board';
    assert.equal(await link.innerText(), `${caption} ›`);
    assert.equal(
      await link
        .locator('..')
        .locator('[aria-label]:not([role="button"]):not([role="link"])')
        .count(),
      1,
      'Profile shows a card'
    );
    await assertLeagueSymbolCopy(cell);
    assert.doesNotMatch(
      await root.innerText(),
      /Your ribbon|Ditt band/u,
      'no monthly ribbon sentence'
    );
    assert.match(
      await cell.innerText(),
      state === 'profile' ? /2[,\s]700 XP/u : /1[,\s]240 XP/u,
      'placed uses league points; not placed keeps profile XP'
    );
    assert.ok(
      !boxesOverlap(await cell.boundingBox(), await page.getByTestId('tab-pill').boundingBox()),
      'weekly XP and league caption are clear of the navigation pill'
    );
    return;
  }
  const overflow = await root.evaluate((node) => {
    const faults = [];
    for (const child of node.querySelectorAll('*')) {
      if (child.closest('[data-testid="league-list"]')) continue;
      // Avatar glow is noninteractive decoration, not clipped copy or a hit target.
      if (!child.textContent && getComputedStyle(child).pointerEvents === 'none') continue;
      const rect = child.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      if (
        rect.left < -1 ||
        rect.right > innerWidth + 1 ||
        rect.top < -1 ||
        rect.bottom > innerHeight + 1
      )
        faults.push(child.textContent?.slice(0, 80));
    }
    return faults;
  });
  assert.deepEqual(overflow, [], `${testCase.name}: no content outside the viewport`);
  const list = page.getByTestId('league-list');
  await assertLeagueSymbolCopy(root);
  if (await list.count()) {
    if (!state.startsWith('sample-') && state !== '27' && state !== 'pin-scroll') {
      for (const [place, userId] of [
        [1, 'league-player-0'],
        [2, 'league-player-1'],
      ]) {
        const mark = list.getByTestId(`league-friend-mark-${userId}`);
        assert.equal(await mark.count(), 1, 'Mirja and Kalle have standings friend marks');
        const row = await list.getByTestId(`league-row-${place}`).boundingBox();
        const box = await mark.boundingBox();
        assert.ok(box.x >= row.x && box.x + box.width <= row.x + row.width, 'friend mark fits row');
      }
      assert.equal(
        await list.getByTestId('league-friend-mark-ui-grammar-user').count(),
        0,
        'own row is not marked as a friend'
      );
    }
    if (state === 'pin-first-partial') {
      const own = list.getByTestId('league-row-6');
      const row = await own.boundingBox();
      const bounds = await list.boundingBox();
      assert.ok(
        row.y < bounds.y && row.y + row.height > bounds.y,
        'first-load landscape own row is partly visible'
      );
      const pin = page.getByTestId('league-pinned');
      await pin.waitFor();
      assert.ok(bounds.y + bounds.height <= (await pin.boundingBox()).y + 1);
      await list.evaluate((node, delta) => (node.scrollTop += delta), row.y - bounds.y - 4);
      await pin.waitFor({ state: 'detached' });
      const full = await own.boundingBox();
      const fullBounds = await list.boundingBox();
      assert.ok(
        full.y >= fullBounds.y && full.y + full.height <= fullBounds.y + fullBounds.height,
        'fully in view unpins after first load'
      );
    }
    await assertLeagueDividers(
      page,
      {
        size: state === 'small' ? 4 : 30,
        promote: state === 'pidro' ? 0 : state === 'deuce' ? 10 : state === 'small' ? 1 : 5,
        demote: state === 'deuce' ? 0 : state === 'pidro' ? 8 : state === 'small' ? 1 : 5,
      },
      testCase.locale
    );
    const ownStanding = list
      .getByTestId(/^league-row-\d+$/)
      .and(list.getByRole('button', { name: /\((you|du)\)/ }));
    const ownRow = await ownStanding.boundingBox();
    const listBounds = await list.boundingBox();
    const ownVisible =
      ownRow.y >= listBounds.y - 1 &&
      ownRow.y + ownRow.height <= listBounds.y + listBounds.height + 1;
    const pinned = page.getByTestId('league-pinned');
    assert.equal(
      await pinned.count(),
      ownVisible ? 0 : 1,
      'pin a partial or fully offscreen own row'
    );
    if (await pinned.count())
      assert.ok(
        listBounds.y + listBounds.height <= (await pinned.boundingBox()).y + 1,
        'no standings row or promotion divider can be overlapped by the pinned footer'
      );
    if (state === '27' || state === 'pin-scroll') {
      const pin = page.getByTestId('league-pinned');
      await pin.waitFor();
      assertInsideViewport('27th place pinned row', await pin.boundingBox(), viewport);
      assert.match(await pin.innerText(), /Bengt/);
      const listBox = await list.boundingBox();
      const pinBox = await pin.boundingBox();
      assert.ok(
        listBox.y + listBox.height <= pinBox.y + 1,
        'pinned row has a separate footer slot, never overlaps standings or the divider'
      );
      if (state === 'pin-scroll') {
        const own = list.getByTestId('league-row-27');
        const rowBox = await own.boundingBox();
        await list.evaluate(
          (node, delta) => (node.scrollTop += delta),
          rowBox.y - listBox.y - listBox.height + 8
        );
        await waitForScreenshotReady(page);
        const visible = await own.boundingBox();
        const bounds = await list.boundingBox();
        const fullyInView =
          visible.y >= bounds.y && visible.y + visible.height <= bounds.y + bounds.height;
        assert.equal(
          await pin.count(),
          fullyInView ? 0 : 1,
          'partial rows pin; reclaiming the footer may make the row fully visible and unpin'
        );
        await list.evaluate(
          (node, delta) => (node.scrollTop += delta),
          visible.y + visible.height - bounds.y - bounds.height + 4
        );
        await pin.waitFor({ state: 'detached' });
        const fullyVisible = await own.boundingBox();
        const fullBounds = await list.boundingBox();
        assert.ok(
          fullyVisible.y >= fullBounds.y &&
            fullyVisible.y + fullyVisible.height <= fullBounds.y + fullBounds.height,
          'only a fully visible own row unpins'
        );
        await list.evaluate((node) => (node.scrollTop = 0));
        await pin.waitFor();
        const scrolled = await list.boundingBox();
        assert.ok(
          scrolled.y + scrolled.height <= (await pin.boundingBox()).y + 1,
          'fully offscreen own row returns to its separate footer slot'
        );
        await page.setViewportSize({ width: 844, height: 100 });
        await pin.waitFor({ state: 'detached' });
        await waitForScreenshotReady(page);
        assert.ok(
          (await list.boundingBox()).height < pinBox.height,
          'stress viewport leaves less list height than the measured pinned footer'
        );
        const changes = await page.getByTestId('league-standings').evaluate(
          (node) =>
            new Promise((resolve) => {
              let count = 0;
              const observer = new MutationObserver(() => count++);
              observer.observe(node, { childList: true, subtree: true });
              setTimeout(() => {
                observer.disconnect();
                resolve(count);
              }, 500);
            })
        );
        assert.equal(
          changes,
          0,
          'height-starved pin allocation settles without mount/unmount loops'
        );
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await pin.waitFor();
      }
    }
    if (state === 'placed') {
      const own = list.getByTestId('league-row-6');
      const row = await own.boundingBox();
      const bounds = await list.boundingBox();
      await list.evaluate((node, delta) => (node.scrollTop += delta), row.y - bounds.y + 8);
      await pinned.waitFor();
      const partial = await own.boundingBox();
      const partialBounds = await list.boundingBox();
      assert.ok(
        partial.y < partialBounds.y && partial.y + partial.height > partialBounds.y,
        'partly above-viewport own row pins too'
      );
      await list.evaluate(
        (node, delta) => (node.scrollTop += delta),
        partial.y + partial.height - partialBounds.y + 4
      );
      await pinned.waitFor();
      const above = await own.boundingBox();
      const scrolled = await list.boundingBox();
      assert.ok(above.y + above.height <= scrolled.y, 'fully above-viewport own row pins too');
      assert.ok(scrolled.y + scrolled.height <= (await pinned.boundingBox()).y + 1);
      await list.evaluate((node) => (node.scrollTop = 0));
      await waitForScreenshotReady(page);
    }
    const bounds = await list.boundingBox();
    assertInsideViewport('standings scroll', bounds, viewport);
    // Offscreen rows may scroll, but the enclosing shell must not.
    assert.equal(await root.evaluate((node) => node.scrollHeight > node.clientHeight + 2), false);
  }
  await assertMinimumTouchTargets(page, testCase.testId, viewport);
  if (state === 'player-sheet') {
    await list.getByTestId('league-row-1').click();
    const sheet = page.getByTestId('player-sheet');
    await sheet.waitFor();
    const chip = page.getByTestId('player-sheet-league');
    await chip.waitFor();
    await page.waitForTimeout(400);
    assert.equal(
      await chip
        .getByText(testCase.locale === 'sv' ? '1:a den här veckan' : '1st this week', {
          exact: true,
        })
        .count(),
      1
    );
    assert.equal(await chip.locator('[aria-label]').count(), 1, 'contextual standing has a card');
    await assertLeagueSymbolCopy(chip);
    await assertAccountSurfaceFits(sheet, testCase.name, viewport);
    return;
  }
  if (state.startsWith('friends')) {
    const friends = page.getByTestId('league-friends');
    await friends.scrollIntoViewIfNeeded();
    await waitForScreenshotReady(page);
    const scroll = page.getByTestId('league-list').or(page.getByTestId('league-empty'));
    await scroll.evaluate((node) => (node.scrollTop = node.scrollHeight));
    await waitForScreenshotReady(page);
    assertInsideViewport('league friends', await friends.boundingBox(), viewport);
    const friendsBox = await friends.boundingBox();
    const scrollBox = await scroll.boundingBox();
    assert.ok(
      friendsBox.y >= scrollBox.y - 1 &&
        friendsBox.y + friendsBox.height <= scrollBox.y + scrollBox.height + 1,
      'all friends rows can scroll clear of the pinned footer'
    );
    const mirja = page.getByTestId('league-friend-friend-mirja');
    await friends
      .getByText(testCase.locale === 'sv' ? 'Vänner den här veckan' : 'Friends this week', {
        exact: true,
      })
      .waitFor();
    const rows = friends.locator('[data-testid^="league-friend-"]');
    const own = friends.getByTestId('league-friend-ui-grammar-user');
    assert.deepEqual(
      await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid'))),
      state === 'friends-not_placed'
        ? ['league-friend-friend-mirja', 'league-friend-friend-kalle']
        : [
            'league-friend-friend-mirja',
            'league-friend-ui-grammar-user',
            'league-friend-friend-kalle',
          ],
      'friends sorted by weekly points, including yourself when placed'
    );
    for (const [id, points] of [
      ['friend-mirja', '3120'],
      ['friend-kalle', '900'],
      ...(state === 'friends-not_placed' ? [] : [['ui-grammar-user', '1240']]),
    ]) {
      const row = friends.getByTestId(`league-friend-${id}`);
      assert.ok(
        (await row.innerText()).replace(/[,\s]/gu, '').endsWith(points),
        `${id} weekly points`
      );
      assert.doesNotMatch(
        await row.innerText(),
        /\d+(?:st|nd|rd|th|:a|:e)\b|this week|den här veckan/iu,
        'no ordinal in friends strip'
      );
    }
    if (await own.count()) {
      assert.match(await own.getAttribute('aria-label'), /Bengt \((you|du)\)/u);
      assert.notEqual(
        await own.evaluate((node) => getComputedStyle(node).backgroundColor),
        await mirja.evaluate((node) => getComputedStyle(node).backgroundColor),
        'own row is highlighted'
      );
    }
    if (state === 'friends-pin') {
      const pin = page.getByTestId('league-pinned');
      const standing = list.getByTestId('league-row-6');
      const assertOwnCopy = async (fullyVisible) => {
        await waitForScreenshotReady(page);
        const bounds = await list.boundingBox();
        const row = await own.boundingBox();
        const original = await standing.boundingBox();
        assert.ok(original.y + original.height < bounds.y, 'standings copy is offscreen');
        assert.equal(
          row.y >= bounds.y && row.y + row.height <= bounds.y + bounds.height,
          fullyVisible,
          'friends copy full visibility from actual element boxes'
        );
        assert.equal(await pin.count(), fullyVisible ? 0 : 1, 'pin only without a full own copy');
      };
      await assertOwnCopy(true);
      await list.evaluate((node) => (node.scrollTop = 500));
      await pin.waitFor();
      await waitForScreenshotReady(page);
      const row = await own.boundingBox();
      const bounds = await list.boundingBox();
      await list.evaluate(
        (node, delta) => (node.scrollTop += delta),
        row.y + row.height / 2 - bounds.y - bounds.height
      );
      await assertOwnCopy(false);
      const partial = await own.boundingBox();
      const partialBounds = await list.boundingBox();
      assert.ok(
        partial.y < partialBounds.y + partialBounds.height &&
          partial.y + partial.height > partialBounds.y + partialBounds.height,
        'partially visible friends copy still needs the pin'
      );
      await list.evaluate(
        (node, delta) => (node.scrollTop += delta),
        partial.y + partial.height - partialBounds.y - partialBounds.height + 4
      );
      await assertOwnCopy(true);
      await list.evaluate((node) => (node.scrollTop = 0));
      await waitForScreenshotReady(page);
      await list.evaluate((node) => (node.scrollTop = node.scrollHeight));
      await assertOwnCopy(true);
    }
    await assertLeagueSymbolCopy(friends);
    await assertMinimumTouchTargets(page, testCase.testId, viewport);
    if (state === 'friends-sheet') {
      await mirja.click();
      const sheet = page.getByTestId('friend-sheet');
      await sheet.waitFor();
      await page.waitForTimeout(400);
      await assertAccountSurfaceFits(sheet, testCase.name, viewport);
      assert.match(await sheet.innerText(), /Mirja/);
    }
  } else if (!state.startsWith('result-')) {
    assert.equal(await page.getByTestId('league-friends').count(), 0, 'no empty friends section');
  }
}

async function main() {
  if (process.argv[2] === '--list-cases') {
    console.log(JSON.stringify(allCases.map(({ name, path }) => ({ name, path }))));
    return;
  }
  const cases = selectCases();
  const matrix = selectViewports().flatMap((viewport) =>
    cases
      .filter((testCase) => {
        if (testCase.tell)
          return (testCase.tellViewports ?? TELL_VIEWPORTS).includes(viewport.name);
        if (testCase.league === 'pin-first-partial') return viewport.name === 'landscape';
        // Timing, not layout: one phone is enough (PID-364).
        if (testCase.sweep === 'on' || (testCase.reducedMotion && testCase.flaky))
          return viewport.name === 'portrait';
        if (
          testCase.news ||
          testCase.league ||
          testCase.popup ||
          testCase.premium ||
          testCase.premiumSheet ||
          testCase.adSheet ||
          testCase.privacyChoices
        )
          return TELL_VIEWPORTS.includes(viewport.name);
        if (
          (testCase.welcome || testCase.name.startsWith('age')) &&
          ['small-portrait', 'compact-portrait', 'tablet-portrait'].includes(viewport.name)
        )
          return true;
        if (
          testCase.words ||
          testCase.ownPace ||
          testCase.classicEnd ||
          testCase.layDown ||
          testCase.classicPasswordDecision ||
          testCase.homeProfile ||
          testCase.details ||
          testCase.scores ||
          testCase.botVoice ||
          testCase.flaky ||
          testCase.sweep ||
          testCase.startupUpdate ||
          testCase.storeNotice ||
          testCase.photo
        )
          return ['portrait', 'small-portrait', 'landscape', 'tablet-portrait'].includes(
            viewport.name
          );
        if (testCase.twoRows)
          return ['landscape', 'android-landscape', 'small-landscape'].includes(viewport.name);
        // PID-381: the piles on the TCL's 360×780 too. Tablets keep their fan.
        if (testCase.upright)
          return [
            'portrait',
            'small-portrait',
            ...(testCase.upright.piles || testCase.upright.pack ? ['android-portrait'] : []),
          ].includes(viewport.name);
        if (testCase.newTableFixture)
          return [
            'portrait',
            'small-portrait',
            'landscape',
            'tablet-portrait',
            'tablet-landscape',
          ].includes(viewport.name);
        if (
          viewport.cases &&
          !viewport.cases.includes(testCase.name) &&
          !(testCase.locale && ['compact-portrait', 'tablet-portrait'].includes(viewport.name))
        )
          return false;
        if (testCase.skipViewports?.includes(viewport.name)) return false;
        return (
          !viewport.tableOnly ||
          testCase.locale ||
          testCase.path.startsWith('/table-dev') ||
          testCase.ruleSet ||
          testCase.lobbyFixture ||
          testCase.name === 'join-invite' ||
          viewport.entryCases?.includes(testCase.name)
        );
      })
      .map((testCase) => ({ id: `${viewport.name}/${testCase.name}` }))
  );
  if (process.argv[2] === '--verify-coverage') {
    const reports = process.argv[3];
    const completed = (
      await Promise.all(
        (await readdir(reports))
          .filter((name) => name.endsWith('.json'))
          .map(async (name) => JSON.parse(await readFile(resolve(reports, name), 'utf8')))
      )
    ).flat();
    verifyCoverage(
      matrix.map(({ id }) => id),
      completed
    );
    for (const { id } of completed) await access(resolve(screenshotRoot, `${id}.png`));
    console.log(
      `visual coverage: all ${completed.length} cases completed exactly once, with captures`
    );
    console.log('Slowest visual cases:');
    for (const { id, ms } of [...completed].sort((a, b) => b.ms - a.ms).slice(0, 15)) {
      console.log(`  ${(ms / 1000).toFixed(2)}s ${id}`);
    }
    return;
  }
  const costs = JSON.parse(
    await readFile(new URL('./ui-case-costs.json', import.meta.url), 'utf8')
  );
  const selected = partitionCases(matrix, process.env.UI_PARTITION, costs);
  if (process.argv[2] === '--list') {
    console.log(JSON.stringify(selected.map(({ id }) => id)));
    return;
  }
  if (!selected.length) throw new Error('No visual cases selected');
  const selectedIds = new Set(selected.map(({ id }) => id));
  await mkdir(screenshotRoot, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const timings = [];

  try {
    for (const viewport of selectViewports()) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: Number(process.env.UI_DEVICE_SCALE ?? 1),
        timezoneId: process.env.UI_TIMEZONE,
      });
      // Endless motion (your breathing turn light) holds its resting frame, so a
      // baseline never catches it mid-breath. See src/utils/stillCapture.ts.
      await context.addInitScript(() => {
        globalThis.__pidroStill = true;
      });
      const screenshotDir = resolve(screenshotRoot, viewport.name);
      await mkdir(screenshotDir, { recursive: true });

      for (const testCase of cases) {
        if (!selectedIds.has(`${viewport.name}/${testCase.name}`)) continue;
        const started = performance.now();
        const page = await context.newPage();
        if (testCase.reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
        // From the first frame: Eli's line and the cards on the felt until the result (PID-364).
        if (testCase.sweep === 'on')
          await page.addInitScript(() => {
            const sweep = { seen: [], cards: [], result: false };
            window.__pidroSweep = sweep;
            const sample = () => {
              sweep.result = !!document.querySelector(
                '[data-testid="hand-result"], [data-testid="hand-points"]'
              );
              if (sweep.result) return;
              const line = document.querySelector('[data-testid="seat-east"]')?.innerText;
              const cards = document.querySelector('[data-testid^="rendered-played-card-count-"]')
                ?.dataset.testid;
              if (line != null && sweep.seen.at(-1) !== line) sweep.seen.push(line);
              if (line != null && cards && sweep.cards.at(-1) !== cards) sweep.cards.push(cards);
              requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          });
        // Reuse CI's existing tablet shards without resizing any other screen.
        const caseViewport = testCase.lobbyFixture
          ? (viewport.lobbyViewport ?? viewport)
          : testCase.viewports?.[viewport.name]
            ? { ...viewport, ...testCase.viewports[viewport.name] }
            : viewport;
        await page.setViewportSize({ width: caseViewport.width, height: caseViewport.height });
        if (
          testCase.homeTick ||
          testCase.league === 'game-delayed' ||
          testCase.league === 'pin-first-partial'
        ) {
          await page.addInitScript(
            ({ homeTick, delayed, initialPartial }) => {
              if (homeTick && !sessionStorage.getItem('ui-league-tick-seeded')) {
                // AsyncStorage's web implementation uses localStorage directly, without a prefix.
                localStorage.setItem(
                  'league-home:v1:ui-grammar-user',
                  JSON.stringify({ week: '2026-11-01T19:00:00Z', league: 'jack', place: 6 })
                );
                sessionStorage.setItem('ui-league-tick-seeded', '1');
              }
              window.__leagueTickSamples = [];
              window.__leagueDelay = {};
              let firstTick;
              let initialScrollSet = false;
              const sample = () => {
                const find = (id) => document.querySelector(`[data-testid="${id}"]`);
                const tick = find('home-league-tick');
                if (homeTick && tick) {
                  firstTick ??= performance.now();
                  if (performance.now() - firstTick < 1500) {
                    const style = getComputedStyle(tick);
                    window.__leagueTickSamples.push({
                      text: tick.textContent,
                      opacity: Number(style.opacity),
                      y: style.transform === 'none' ? 0 : new DOMMatrix(style.transform).m42,
                    });
                  }
                }
                if (delayed && find('game-over-league-slot')) {
                  const boxes = {};
                  for (const id of ['play-again', 'game-over-home']) {
                    const box = find(id)?.getBoundingClientRect();
                    if (box?.width && box.height)
                      boxes[id] = { x: box.x, y: box.y, width: box.width, height: box.height };
                  }
                  if (Object.keys(boxes).length === 2) {
                    if (!find('game-over-league')) window.__leagueDelay.before = boxes;
                    else window.__leagueDelay.after ??= boxes;
                  }
                }
                // A restored initial scroll offset exercises first layout, before any test interaction.
                if (initialPartial && !initialScrollSet) {
                  const list = find('league-list');
                  const own = list?.querySelector('[data-testid="league-row-6"]');
                  if (list?.clientHeight && own?.getBoundingClientRect().height) {
                    const row = own.getBoundingClientRect();
                    list.scrollTop += row.top - list.getBoundingClientRect().top + 8;
                    initialScrollSet = true;
                  }
                }
                if (
                  (homeTick && (!firstTick || performance.now() - firstTick < 1500)) ||
                  (delayed && !window.__leagueDelay.after) ||
                  (initialPartial && !initialScrollSet)
                )
                  requestAnimationFrame(sample);
              };
              requestAnimationFrame(sample);
            },
            {
              homeTick: Boolean(testCase.homeTick),
              delayed: testCase.league === 'game-delayed',
              initialPartial: testCase.league === 'pin-first-partial',
            }
          );
        }
        await page.addInitScript(
          ({
            ageGate,
            authenticated,
            fixture,
            pendingInvite,
            welcomeSeen,
            photoLocale,
            homeTick,
          }) => {
            globalThis.localStorage.setItem('age-gate-storage', ageGate);
            if (!homeTick) globalThis.localStorage.removeItem('league-home:v1:ui-grammar-user');
            // Marcel's welcome covers every screen until it is seen; only its own cases want it.
            if (welcomeSeen) globalThis.localStorage.setItem('news-seen:welcome', '1');
            else globalThis.localStorage.removeItem('news-seen:welcome');
            if (!globalThis.sessionStorage.getItem('ui-settings-initialized')) {
              globalThis.localStorage.removeItem('settings-storage');
              // /profile is a real route: use its saved preference, not a locale query.
              if (photoLocale)
                globalThis.localStorage.setItem(
                  'settings-storage',
                  JSON.stringify({ state: { language: photoLocale }, version: 0 })
                );
              globalThis.sessionStorage.setItem('ui-settings-initialized', 'true');
            }
            if (authenticated) globalThis.localStorage.setItem('auth-storage', fixture);
            else globalThis.localStorage.removeItem('auth-storage');
            if (pendingInvite) {
              globalThis.localStorage.setItem(
                'pending-invite-storage',
                JSON.stringify({
                  state: {
                    pendingInvite: { code: '7KQ4M2XB', source: 'copy', receivedAt: 1 },
                  },
                  version: 0,
                })
              );
            } else {
              globalThis.localStorage.removeItem('pending-invite-storage');
            }
          },
          {
            ageGate: ageGateFixture,
            authenticated: testCase.authenticated === true,
            fixture: testCase.authFixture ?? authFixture,
            pendingInvite: testCase.pendingInvite === true,
            welcomeSeen: !testCase.welcomeUnseen,
            homeTick: Boolean(testCase.homeTick),
            photoLocale:
              testCase.photo ||
              testCase.popup ||
              testCase.adSheet ||
              testCase.storeNotice ||
              testCase.league ||
              testCase.path === '/welcome' ||
              testCase.path.startsWith('/(auth)/')
                ? (testCase.locale ?? 'en')
                : testCase.tell
                  ? (testCase.tellLocale ?? 'en')
                  : null,
          }
        );
        if (testCase.pendingInvite) {
          await page.route('**/api/v1/invites/7KQ4M2XB', async (route) => {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                data: {
                  invite: {
                    code: '7KQ4M2XB',
                    state: 'open',
                    host: 'Anna',
                    seats_taken: 2,
                    seats_total: 4,
                    seat_hint: 'partner',
                    label: null,
                    expires_at: '2099-01-01T00:00:00Z',
                  },
                },
              }),
            });
          });
        }
        if (testCase.manualCode) {
          await page.route('**/api/v1/invites/7KQ4M2XB', (route) =>
            route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                data: {
                  invite: {
                    code: '7KQ4M2XB',
                    state: 'open',
                    host: 'Marcel',
                    seats_taken: 2,
                    seats_total: 4,
                    seat_hint: 'partner',
                    label: 'Friday game',
                    expires_at: '2099-09-03T15:30:00Z',
                    config: {
                      name: null,
                      solo: false,
                      bot_difficulty: 'basic',
                      rule_set: 'louisiana',
                    },
                  },
                },
              }),
            })
          );
        }
        if (
          testCase.league ||
          testCase.popup ||
          testCase.storeNotice ||
          testCase.name === 'game-away' ||
          testCase.name.startsWith('friend-notice-')
        ) {
          // These deterministic fixtures need no server, even beside a live e2e backend.
          await page.route('**/api/v1/**', (route) => route.abort());
        }
        if (testCase.league?.startsWith('result-stayed')) {
          await page.addInitScript(() => {
            window.__leagueStayedFlashed = false;
            new MutationObserver(() => {
              if (
                document.querySelector(
                  '[data-testid="league-result"], [data-testid="league-result-backdrop"]'
                )
              )
                window.__leagueStayedFlashed = true;
            }).observe(document, { childList: true, subtree: true });
          });
        }
        if (testCase.league === 'result-stayed-host') {
          const data = JSON.parse(
            await readFile(
              resolve(mobileRoot, 'src/features/leagueSamples/pending_stayed.json'),
              'utf8'
            )
          );
          page.leagueSeenPosts = [];
          await page.route('**/api/v1/league', (route) => route.fulfill({ json: data }));
          await page.route('**/api/v1/league/results/*/seen', async (route) => {
            assert.equal(route.request().method(), 'POST');
            assert.equal(
              decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2)),
              data.pending_result.id
            );
            page.leagueSeenPosts.push(route.request().url());
            await route.fulfill({ status: 204 });
            await page.evaluate(() => {
              window.__leagueStayedAck = true;
            });
          });
        }
        if (testCase.league === 'player-sheet') {
          await page.route('**/api/v1/profiles/**', (route) =>
            route.fulfill({
              json: {
                data: {
                  user_id: 'league-player-0',
                  username: 'Mirja',
                  display_name: 'Mirja',
                  avatar_url: null,
                  bio: null,
                  level: 44,
                  prestige: 0,
                  title: null,
                  pin: null,
                  classic: null,
                  record: { games: 2400, win_rate: 0.52 },
                  medals: 5,
                  together: { games: 0, won_as_partners: 0, against_games: 0, against_won: 0 },
                },
              },
            })
          );
        }
        if (testCase.league?.startsWith('settings-')) {
          const state = testCase.league.slice(9);
          const sample =
            state === 'hidden'
              ? 'opted_out'
              : state === 'off' || state === 'guest'
                ? state
                : 'placed';
          let data = JSON.parse(
            await readFile(resolve(mobileRoot, `src/features/leagueSamples/${sample}.json`), 'utf8')
          );
          data.pending_result = null;
          await page.route('**/api/v1/league', (route) => route.fulfill({ json: data }));
          let failed = false;
          await page.route('**/api/v1/league/hidden', async (route) => {
            if (state === 'failed' && !failed) {
              failed = true;
              return route.fulfill({ status: 500, json: { error: 'Unavailable' } });
            }
            const { hidden } = route.request().postDataJSON();
            assert.equal(typeof hidden, 'boolean');
            data = { ...data, status: hidden ? 'opted_out' : 'not_placed', room: null, me: null };
            await route.fulfill({ json: data });
          });
        }
        if (testCase.name === 'lobby-player-sheet') {
          await page.route('**/api/v1/profiles/**', (route) =>
            route.fulfill({
              json: {
                data: {
                  user_id: 'claas',
                  username: 'Claas',
                  display_name: 'Claas',
                  avatar_url: null,
                  bio: null,
                  level: 100,
                  prestige: 4,
                  title: 'Legend',
                  pin: null,
                  classic: null,
                  record: { games: 2400, win_rate: 0.52 },
                  medals: 5,
                  together: { games: 0, won_as_partners: 0, against_games: 0, against_won: 0 },
                },
              },
            })
          );
        }
        if (testCase.teamCase) {
          await page.route('**/api/v1/profiles/p-east', (route) =>
            route.fulfill({
              json: {
                data: {
                  user_id: 'p-east',
                  username: 'Eli',
                  display_name: 'Eli',
                  avatar_url: null,
                  bio: null,
                  level: 9,
                  prestige: 0,
                  title: 'Apprentice',
                  pin: null,
                  classic: null,
                  record: { games: 40, win_rate: 0.5 },
                  medals: 1,
                  together: { games: 0, won_as_partners: 0, against_games: 0, against_won: 0 },
                },
              },
            })
          );
        }
        if (testCase.playerProfile || testCase.talk === 'face-tap') {
          // At the talk table West is Antti; elsewhere mfios1.
          const name = testCase.talk ? 'Antti' : 'mfios1';
          await page.route('**/api/v1/profiles/p-west', (route) =>
            route.fulfill({
              json: {
                data: {
                  user_id: 'p-west',
                  username: name,
                  display_name: name,
                  avatar_url: null,
                  bio: null,
                  level: 12,
                  prestige: 0,
                  title: 'Apprentice',
                  pin: null,
                  classic: null,
                  record: { games: 120, win_rate: 0.5 },
                  medals: 2,
                  together: { games: 0, won_as_partners: 0, against_games: 0, against_won: 0 },
                },
              },
            })
          );
        }
        let answerProfile = () => {};
        const profileAnswered = ['profile', 'profile-guest', 'settings'].includes(testCase.name)
          ? new Promise((answer) => (answerProfile = answer))
          : null;
        if (
          [
            'home',
            'home-guest',
            'home-table-unknown',
            'update-notice',
            'update-notice-home-guest',
            'profile',
            'profile-guest',
            'profile-badges',
            'settings',
            'league',
          ].includes(testCase.name) ||
          testCase.homeProfile ||
          testCase.popup ||
          testCase.adSheet ||
          testCase.storeNotice ||
          testCase.photo ||
          testCase.tell ||
          testCase.news ||
          testCase.league ||
          testCase.name.startsWith('edge-home-') ||
          testCase.name.startsWith('edge-profile-')
        ) {
          await page.route('**/api/v1/profile', async (route) => {
            await profileAnswered;
            const guest = testCase.name.endsWith('-guest');
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                data: {
                  user_id: guest ? 'ui-grammar-guest' : 'ui-grammar-user',
                  username: guest ? 'guest_7KQ4M2XB' : 'Bengt',
                  display_name: guest ? 'Lucky Moose' : 'Bengt',
                  avatar_url: null,
                  bio: null,
                  games_played: guest ? 1 : 28,
                  veteran: guest
                    ? { level: 2, xp: 410, title: 'Newcomer', progress: [90, 400] }
                    : { level: 7, xp: 2140, title: 'Regular', progress: [340, 720] },
                  xp: guest
                    ? { this_week: 410, this_month: 410 }
                    : { this_week: 1240, this_month: 2140 },
                  record: guest
                    ? { games: 1, wins: 1, losses: 0, win_rate: 1 }
                    : { games: 1890, wins: 1011, losses: 879, win_rate: 1011 / 1890 },
                  classic: guest
                    ? null
                    : { name: 'Bengt64', games_played: 1862, wins: 998, losses: 864, level: 14 },
                },
              }),
            });
          });
          await page.route('**/api/v1/lobby', async (route) => {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                data: {
                  my_rejoinable: [],
                  open_tables: [
                    { code: 'OPEN01', name: 'North table', status: 'waiting', seats: [] },
                    { code: 'OPEN02', name: 'South table', status: 'waiting', seats: [] },
                    { code: 'OPEN03', name: 'West table', status: 'waiting', seats: [] },
                  ],
                  substitute_needed: [],
                  spectatable: [],
                },
              }),
            });
          });
        }
        if (testCase.tell || testCase.news) await routeFeedback(page, testCase);
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(String(error?.message ?? error)));

        try {
          const url = new URL(`${baseUrl}${testCase.path}`);
          if (viewport.safeArea) url.searchParams.set('safeArea', viewport.safeArea);
          const response = await page.goto(url.href, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
          });
          if (!response?.ok()) {
            throw new Error(`${testCase.path} returned ${response?.status() ?? 'no response'}`);
          }
          await suppressDevOverlays(page);
          if (testCase.name.startsWith('age')) {
            await page
              .getByTestId('language-switch')
              .getByRole('radio', {
                name: testCase.locale === 'sv' ? 'Svenska' : 'English',
                exact: true,
              })
              .click();
            await page
              .getByTestId('language-switch')
              .getByRole('radio', { name: testCase.locale === 'sv' ? 'Svenska' : 'English' })
              .blur();
          }
          if (testCase.manualCode) {
            await page.getByTestId('invite-code-input').fill('7kq4-m2xb');
            await page.getByRole('button', { name: 'Continue', exact: true }).click();
            await page.waitForURL(
              (url) =>
                url.pathname === '/join/7KQ4M2XB' && url.searchParams.get('source') === 'typed'
            );
          }
          if (testCase.name === 'table-bidding') {
            await assertBiddingRevealSequence(page, viewport);
          }
          await assertDealHold(page, testCase, caseViewport);
          if (testCase.verifyPlayedCardPersistence) {
            await assertPlayedCardPersistence(page, viewport);
          }
          if (testCase.playPosition) {
            if (testCase.playPosition === 'right') {
              await page.evaluate(() => {
                const setAttribute = Element.prototype.setAttribute;
                const stalled = new Set();
                Element.prototype.setAttribute = function (key, value) {
                  const result = setAttribute.call(this, key, value);
                  if (key === 'aria-label' && this.getAttribute('data-testid') === 'play-fixture') {
                    const fixture = JSON.parse(value);
                    const stage = fixture.completed
                      ? 'hold'
                      : fixture.turn === 'north'
                        ? 'landing'
                        : null;
                    if (stage && !stalled.has(stage)) {
                      stalled.add(stage);
                      // A slow commit must not consume landing or reading time.
                      const start = performance.now();
                      while (performance.now() - start < 150) {}
                    }
                  }
                  return result;
                };
              });
            }
            await assertPlayMotion(page, testCase.playPosition, caseViewport);
          }
          if (testCase.trickStays) await assertTrickStays(page);
          if (testCase.sweepWinner) {
            await assertCardCollection(
              page,
              testCase.sweepWinner,
              testCase.reducedMotion,
              caseViewport
            );
          }
          if (testCase.verifyDealerCutCards) {
            await assertDealerCutCards(page, viewport);
          }
          // PID-334: level chips show before the first deal, never during a hand.
          if (testCase.levels != null) {
            const chips = await page
              .locator('[data-testid^="seat-"][data-testid$="-level"]')
              .count();
            if (testCase.levels) assert.ok(chips > 0, `${testCase.name}: seats show their level`);
            else assert.equal(chips, 0, `${testCase.name}: no level chips during a hand`);
          }
          if (testCase.verifyCatchUp) {
            await assertDealerCatchUp(page, viewport);
          }
          if (testCase.verifyDealerSelection || testCase.verifyDealerPrivacy) {
            await assertDealerSecondDeal(page, testCase, viewport);
          }
          // The ticker opens the hand's log; tight phones have none, and their
          // score panel opens it instead (PID-304).
          if (testCase.openLog) {
            const ticker = page.getByRole('button', {
              name: "Recent table actions. Opens this hand's log.",
              exact: true,
            });
            const shown = await ticker.waitFor({ timeout: 3000 }).then(
              () => true,
              () => false
            );
            if (shown) await ticker.click();
            else {
              await page.getByRole('button', { name: /Every hand\.$/ }).click();
              await page.getByTestId('hand-history-this-hand').click();
            }
          }
          if (testCase.open) {
            if (testCase.botVoice)
              assert.equal(
                await page.getByTestId('bot-profile-modal').count(),
                0,
                'no bot card opens until its profile is tapped'
              );
            const scope =
              testCase.playerProfile && testCase.path.includes('game_over')
                ? page.getByTestId('game-over-overlay')
                : page;
            await scope.getByRole('button', { name: testCase.open, exact: true }).click();
            if (testCase.name.endsWith('friends-block'))
              await page
                .getByRole('button', {
                  name: testCase.locale === 'sv' ? 'Blockera Nora' : 'Block Nora',
                  exact: true,
                })
                .click();
            if (testCase.name.endsWith('friends-remove'))
              await page
                .getByRole('button', {
                  name: testCase.locale === 'sv' ? 'Ta bort från vänner' : 'Remove from friends',
                  exact: true,
                })
                .click();
            if (testCase.name.endsWith('friends-profile'))
              await page
                .getByRole('button', {
                  name: testCase.locale === 'sv' ? 'Visa hela profilen' : 'See full profile',
                  exact: true,
                })
                .click();
            await waitForScreenshotReady(page);
          }
          if (testCase.scores) {
            const sv = testCase.locale === 'sv';
            if (testCase.scores === 'table' || testCase.scores === 'game-over') {
              if (testCase.scores === 'table')
                await page
                  .getByRole('button', { name: sv ? /Alla givar\.$/ : /Every hand\.$/ })
                  .click();
              else await page.getByTestId('every-hand').click();
              const list = page.getByTestId('hand-history');
              await list.waitFor();
              const newest = testCase.scores === 'table' ? 9 : 10;
              const seen = [];
              const older = page.getByRole('button', { name: sv ? 'Äldre' : 'Older', exact: true });
              do {
                const rows = list.locator('[data-testid^="history-hand-"]');
                for (const row of await rows.all()) {
                  const number = Number((await row.getAttribute('data-testid')).split('-').at(-1));
                  seen.push(number);
                  assertInsideViewport('hand row', await row.boundingBox(), caseViewport);
                }
                if (!(await older.count()) || (await older.isDisabled())) break;
                await older.click();
              } while (true);
              assert.deepEqual(
                seen,
                Array.from({ length: newest }, (_, i) => newest - i)
              );
              const newer = page.getByRole('button', { name: sv ? 'Nyare' : 'Newer', exact: true });
              while ((await newer.count()) && !(await newer.isDisabled())) await newer.click();
              const latest = page.getByTestId(`history-hand-${newest}`);
              assert.match(await latest.innerText(), newest === 10 ? /14–0/ : /7–7/);
              assert.match(await latest.innerText(), newest === 10 ? /62–29/ : /48–29/);
              assert.match(await latest.innerText(), newest === 10 ? /14 ♥/ : /12 ♥/);
              assert.match(
                await latest.innerText(),
                newest === 10 ? (sv ? /Klarat/ : /Made/) : sv ? /Missat/ : /Missed/
              );
            } else if (testCase.scores.startsWith('all-14')) {
              await page.getByTestId('hand-result').waitFor();
              await page.getByText(sv ? 'Alla 14!' : 'All 14!', { exact: true }).waitFor();
              const team = testCase.scores.endsWith('theirs') ? 'east_west' : 'north_south';
              assert.equal(await page.getByTestId(`hand-tray-${team}`).locator('img').count(), 6);
              for (const tray of await page.locator('[data-testid^="hand-tray-"]').all()) {
                const box = await tray.boundingBox();
                assertInsideViewport('point-card tray', box, caseViewport);
                for (const image of await tray.locator('img').all()) {
                  const card = await image.boundingBox();
                  assertInsideViewport('point card', card, caseViewport);
                  assert.ok(
                    card.x >= box.x && card.x + card.width <= box.x + box.width,
                    'fan fits tray'
                  );
                }
              }
            } else {
              // The lines only: no axis totals, no target figure (PID-292).
              await page.getByTestId('race-chart').locator('svg').waitFor();
              assert.equal(await page.getByTestId('race-chart').textContent(), '');
              await page
                .getByTestId('how-it-went')
                .getByText(sv ? 'Så gick det · 10 giv' : 'How it went · 10 hands', { exact: true })
                .waitFor();
              assert.equal(await page.getByText(/Led from here|Ledde härifrån/).count(), 0);
            }
          }
          if (testCase.name.endsWith('friends-guest')) {
            await page.getByTestId('auth-sheet').waitFor();
            await waitForScreenshotReady(page);
          }
          if (
            testCase.newTableFixture ||
            testCase.testId === 'password-keypad' ||
            testCase.testId === 'friend-sheet' ||
            testCase.testId === 'player-sheet' ||
            testCase.testId === 'feedback-sheet' ||
            testCase.testId === 'news-sheet'
          ) {
            await page.getByTestId(testCase.testId).waitFor();
            await waitForScreenshotReady(page);
          }
          if (testCase.appUpdate) await assertAppUpdate(page, testCase);
          if (testCase.testAd) await assertTestAd(page);
          if (testCase.premium) await assertPremium(page, testCase, caseViewport);
          if (testCase.premiumSheet) await assertPremiumSheet(page, testCase, caseViewport);
          await assertAdSheet(page, testCase, caseViewport);
          if (testCase.privacyChoices) await assertPrivacyChoices(page, testCase);
          if (testCase.newTableFixture?.startsWith('ready-error')) {
            const sv = testCase.newTableLanguage === 'sv';
            await page
              .getByRole('button', { name: sv ? 'Jag är redo' : "I'm ready", exact: true })
              .click();
            const message =
              testCase.newTableFixture === 'ready-error'
                ? sv
                  ? 'Alla platser måste vara fyllda innan spelet kan börja.'
                  : 'All seats must be filled before starting.'
                : sv
                  ? 'Det gick inte att bekräfta. Kontrollera bordet och försök igen.'
                  : 'Readiness was not confirmed. Check the table and try again.';
            assert.equal(await page.getByTestId('waiting-error').innerText(), message);
            await assertAccountSurfaceFits(
              page.getByTestId('waiting-table'),
              testCase.name,
              caseViewport
            );
          }
          if (testCase.name.startsWith('friend-notice-')) {
            await page.getByTestId('friend-notice').waitFor();
            await waitForScreenshotReady(page);
          }
          await assertAccountButtonsStayPut(page, testCase.name, answerProfile);
          await assertTargetGeometry(page, testCase, caseViewport);
          await assertBidLines(page, testCase, caseViewport);
          await assertCrew(page, testCase);
          await assertBotVoice(page, testCase, caseViewport);
          await assertTalk(page, testCase, caseViewport);
          await assertPlayLines(page, testCase, caseViewport);
          await assertSweep(page, testCase);
          await assertTwoRows(page, testCase, caseViewport);
          await assertUpright(page, testCase, caseViewport);
          if (testCase.locale && testCase.path.includes('game_over')) {
            await page
              .getByTestId('victory-confetti')
              .waitFor({ state: 'detached', timeout: 7000 });
          }
          await assertCountHelp(page, testCase, caseViewport);
          await assertClassicEnd(page, testCase, caseViewport);
          await assertLayDown(page, testCase, caseViewport);
          if (testCase.fold) {
            if (testCase.fold.south) await page.getByTestId('rendered-hand-card-count-0').waitFor();
            for (const [seat, count] of Object.entries(testCase.fold)) {
              const pile = page.getByTestId(`seat-${seat}-folded`);
              await pile.waitFor();
              assert.equal(await pile.locator('img').count(), count);
              for (const image of await pile.locator('img').all()) {
                assert.match(await image.getAttribute('src'), /cardback\.png/);
                assertInsideViewport(
                  `${testCase.name} ${seat} back`,
                  await getStableBox(image, page),
                  caseViewport
                );
              }
            }
            assert.equal(await page.getByTestId('seat-east-folded').count(), 0);
            assert.equal(await page.getByTestId('seat-east-cards').locator('img').count(), 4);
            for (const seat of ['north', 'west'].filter((s) => testCase.fold[s])) {
              assert.equal(await page.getByTestId(`seat-${seat}-cards`).locator('img').count(), 0);
            }
          }
          if (testCase.fold || testCase.countHelp)
            await assertFoldGeometry(page, testCase, caseViewport);
          await assertGameOver(page, testCase, caseViewport);
          await assertRulePresentation(page, testCase);
          if (testCase.name === 'home') {
            await page.getByText('Bengt', { exact: true }).waitFor();
            await page.getByText('28 games · Level 7', { exact: true }).waitFor();
            await page.getByText('3 tables open', { exact: true }).waitFor();
          } else if (testCase.name === 'home-table-unknown') {
            await page
              .getByText('We could not check whether you are at another table.', { exact: false })
              .waitFor();
          } else if (testCase.name === 'game-away') {
            await page.getByRole('button', { name: "I'm back" }).waitFor();
            await page.getByRole('button', { name: 'Back to lobby' }).waitFor();
          } else if (testCase.name === 'home-guest') {
            await page.getByText('Lucky Moose', { exact: true }).waitFor();
            await page.getByText('Guest · 1 game', { exact: true }).waitFor();
          }
          if (viewport.name === 'landscape' && testCase.name.startsWith('home')) {
            const expectedHeight = testCase.name.endsWith('-guest') ? 150 : 170;
            for (const tile of ['home-quick-game', 'home-play-online']) {
              const box = await getStableBox(page.getByTestId(tile), page);
              assert.equal(Math.round(box?.height ?? 0), expectedHeight, `${tile} height`);
            }
          }
          if (
            testCase.name.startsWith('table-game-over') ||
            testCase.name === 'table-louisiana-game-over'
          ) {
            await page
              .getByTestId('victory-confetti')
              .waitFor({ state: 'detached', timeout: 7000 });
          }
          // Canvas sprites are driven by Reanimated, outside the browser's CSS
          // animation API. Keep their settling window; DOM-only fixtures can
          // proceed as soon as their actual assets and modal animations finish.
          const tablePhase = new URL(testCase.path, baseUrl).searchParams.get('phase') ?? '';
          if (testCase.path.startsWith('/table-dev') && !/^(waiting|ready)/.test(tablePhase)) {
            if (tablePhase === 'dealer_selection') {
              await assertDealerCutCards(page, viewport);
              // Four cut sprites exist before they land. The staggered cuts and
              // winner reveal take 3940ms; include a margin before pixel capture.
              await page.waitForTimeout(4_500);
            } else {
              await page.waitForTimeout(1_200);
            }
          }
          await assertFirstLaunchScreens(page, testCase, caseViewport);
          await assertFeedbackRow(page, testCase, caseViewport);
          await assertTellState(page, testCase, caseViewport);
          await assertNewsState(page, testCase, caseViewport);
          if (testCase.popup) await assertNewsPopup(page, testCase, caseViewport);
          await assertPhotoSheet(page, testCase, caseViewport);
          if (testCase.league) await assertLeague(page, testCase, caseViewport);
          await waitForScreenshotReady(page);
          if (testCase.name.startsWith('edge-') || testCase.testId === 'game-loading-screen') {
            const background = await page.evaluate(() =>
              [...document.images].some((image) => {
                if (!image.src.includes('/bg.png')) return false;
                const box = image.getBoundingClientRect();
                return (
                  box.top <= 0 &&
                  box.left <= 0 &&
                  box.bottom >= innerHeight &&
                  box.right >= innerWidth
                );
              })
            );
            assert.ok(background, `${testCase.name}: the image covers all four viewport edges`);
            if (testCase.open || testCase.openLog) {
              const backdrop = await page.getByTestId('table-utility-window').evaluate((window) => {
                const box = window.parentElement.getBoundingClientRect();
                return { top: box.top, bottom: box.bottom };
              });
              assert.equal(backdrop.top, 0, `${testCase.name}: backdrop reaches the top`);
              assert.equal(
                backdrop.bottom,
                caseViewport.height,
                `${testCase.name}: backdrop reaches the bottom`
              );
            }
          }
          if (testCase.paceSettings) {
            const pace = page.getByTestId('settings-pace');
            await pace.scrollIntoViewIfNeeded();
            for (const choice of await pace.getByRole('radio').all()) {
              const box = await choice.boundingBox();
              assert.ok(box.height >= 48, 'Every Pace choice must be at least 48 points tall');
            }
            if (testCase.path.startsWith('/table-dev')) {
              // Sound is the Settings tab's switch: same words, same saved setting.
              const sv = new URL(testCase.path, baseUrl).searchParams.get('locale') === 'sv';
              const sound = page.getByRole('switch', { name: sv ? 'Ljud' : 'Sound', exact: true });
              await page
                .getByText(sv ? 'Spela spelets ljudeffekter.' : 'Play game sound effects.', {
                  exact: true,
                })
                .waitFor();
              const saved = () =>
                page.evaluate(
                  () => JSON.parse(localStorage.getItem('settings-storage')).state.soundEnabled
                );
              assert.equal(await sound.getAttribute('aria-checked'), 'true');
              await sound.click();
              assert.equal(await sound.getAttribute('aria-checked'), 'false');
              assert.equal(await saved(), false, 'Sound off at the table saves the setting');
              await sound.click();
              assert.equal(await sound.getAttribute('aria-checked'), 'true');
              assert.equal(await saved(), true, 'Sound on at the table saves the setting');
            }
            const own = pace.getByRole('radio').nth(1);
            await own.click();
            assert.equal(await own.getAttribute('aria-checked'), 'true');
            assertInsideViewport('Pace', await pace.boundingBox(), caseViewport);
            if (testCase.path.startsWith('/table-dev')) {
              const overflow = await page
                .getByTestId('table-utility-window')
                .evaluate((window) =>
                  [...window.querySelectorAll('*')].some(
                    (node) =>
                      ['auto', 'scroll'].includes(getComputedStyle(node).overflowY) &&
                      node.scrollHeight > node.clientHeight + 2
                  )
                );
              assert.equal(overflow, false, 'Table settings must fit without scrolling');
            }
          }
          if (pageErrors.length) {
            throw new Error(`${testCase.name} page errors: ${pageErrors.join(' | ')}`);
          }
          if (testCase.lobbyFixture === 'locked') await assertLobbyPresentation(page, testCase);
          await page.screenshot({
            path: resolve(screenshotDir, `${testCase.name}.png`),
            fullPage: false,
          });
          if (testCase.popup) {
            const update = !['news', 'link'].includes(testCase.popup);
            await page.evaluate(() => {
              window.open = (url) => {
                window.__popupURL = String(url);
                return null;
              };
            });
            await page.getByTestId(update ? 'news-popup-later' : 'news-popup-action').click();
            await page.getByTestId('news-popup').waitFor({ state: 'detached' });
            if (testCase.popup === 'link')
              assert.equal(
                await page.evaluate(() => window.__popupURL),
                'https://example.invalid/news'
              );
            if (update) {
              await page.reload();
              await page.evaluate(() => {
                window.open = (url) => {
                  window.__popupURL = String(url);
                  return null;
                };
              });
              await page.getByTestId('news-popup-action').click();
              await page.getByTestId('news-popup').waitFor({ state: 'detached' });
              assert.equal(
                await page.evaluate(() => window.__popupURL),
                `https://example.invalid/pidro-${testCase.popup === 'ios' ? 'ios' : 'android'}`
              );
            }
          }
          if (testCase.league === 'rules') {
            await page.getByTestId('league-rules-close').click();
            await page.getByTestId('league-rules').waitFor({ state: 'detached' });
            assert.equal(await page.getByTestId('league-intro').count(), 0);
            await assertLeagueSymbolCopy(page.getByTestId('league-screen'));
          } else if (testCase.league === 'result-up') {
            await page.getByTestId('league-result-continue').click();
            await page.waitForURL((url) => url.pathname === '/league');
            await page.getByTestId('league-result').waitFor({ state: 'detached' });
            await waitForScreenshotReady(page);
            assert.equal(
              await page.getByTestId('league-intro').count(),
              0,
              'Continue goes straight to standings'
            );
            await assertLeagueSymbolCopy(page.getByTestId('league-screen'));
          } else if (testCase.league === 'result-down') {
            await page.getByTestId('league-result-backdrop').click({ position: { x: 2, y: 2 } });
            await page.getByTestId('league-result').waitFor({ state: 'detached' });
            assert.equal(
              new URL(page.url()).pathname,
              '/home',
              'backdrop dismisses without navigation'
            );
          }
          if (testCase.league === 'settings-failed') {
            await page.getByTestId('league-hide-confirm').getByRole('button').click();
            await page.getByTestId('league-hide-confirm').waitFor({ state: 'detached' });
            assert.equal(
              await page
                .getByTestId('settings-league')
                .getByRole('switch')
                .getAttribute('aria-checked'),
              'true',
              'retry adopts the successful server response'
            );
          }
          // The welcome covers Home on purpose until Let's play.
          // So does an open sheet, on purpose.
          if (
            !testCase.welcome &&
            testCase.testId !== 'feedback-sheet' &&
            testCase.testId !== 'news-sheet' &&
            testCase.testId !== 'ad-sheet'
          )
            await assertHomeHeaderClear(page, new URL(page.url()).pathname, caseViewport);
          await assertHomeProfile(page, testCase, caseViewport);
          await assertLocalization(page, testCase, caseViewport);
          if (testCase.lobbyFixture !== 'locked') await assertLobbyPresentation(page, testCase);
          await assertFriendsPresentation(page, testCase.name);
          await assertCreationPresentation(page, testCase);
          await assertPasswordKeypad(page, testCase, caseViewport);
          await assertSeatPicker(page, testCase, caseViewport);
          await assertClassicLogin(page, testCase, caseViewport);
          await assertAuthFormInteractions(page, testCase.name, viewport);
          await assertWelcomeGuestInteractions(page, testCase.name, viewport);
          await assertWelcomeSettingsInteractions(page, testCase.name);
          await assertHomeGuestInteractions(page, testCase.name);
          await assertFriendNotice(page, testCase.name, caseViewport);
          await assertTableInvitation(page, testCase, caseViewport);
          if (testCase.startupUpdate) {
            const screen = page.getByTestId('updating-screen');
            const sv = testCase.locale === 'sv';
            await screen
              .getByText(sv ? 'Uppdaterar Pidro…' : 'Updating Pidro…', { exact: true })
              .waitFor();
            await screen
              .getByText(sv ? 'Några sekunder' : 'A few seconds', { exact: true })
              .waitFor();
            assert.equal(await screen.getByRole('progressbar').getAttribute('aria-valuenow'), '60');
            const fits = await screen.evaluate((root) => {
              return [root, ...root.querySelectorAll('*')].every((element) => {
                const box = element.getBoundingClientRect();
                return (
                  box.left >= 0 &&
                  box.top >= 0 &&
                  box.right <= innerWidth + 1 &&
                  box.bottom <= innerHeight + 1 &&
                  element.scrollWidth <= element.clientWidth + 1 &&
                  element.scrollHeight <= element.clientHeight + 1
                );
              });
            });
            assert.ok(fits, 'startup copy and bar fit without clipping or scrolling');
          }
          await assertUpdateNotice(page, testCase.name, caseViewport);
          await assertTableMessageReadable(page, testCase.name, caseViewport);
          await assertDeleteAccountConfirmation(page, testCase.name, screenshotDir);
          await assertAuthSheetKeepsTyping(page, testCase.name);
          await assertSwitchInteractions(page, testCase.name, screenshotDir);
          await assertTableDetails(page, testCase, caseViewport);
          await assertSmallTable(page, testCase, caseViewport);
          await assertStatusSeats(page, testCase, caseViewport);
          await assertTeams(page, testCase);
          await assertTeamLines(page, testCase, caseViewport);
          await assertRowControls(page, testCase.name, screenshotDir);
          await assertFriendComponents(page, testCase.name, screenshotDir);
          await assertRuleInteractions(page, testCase, viewport, screenshotDir);
          await assertTellInteractions(page, testCase, caseViewport);
          await assertNewsInteractions(page, testCase, caseViewport);
          if (testCase.verifyReadiness) {
            const panel = await getStableBox(
              page.getByRole('button', { name: "I'm ready", exact: true }),
              page
            );
            for (const position of ['north', 'east', 'south', 'west']) {
              const seat = await getStableBox(page.getByTestId(`new-table-seat-${position}`), page);
              if (!panel || !seat || boxesOverlap(panel, seat)) {
                throw new Error(`Readiness panel overlaps ${position} in ${viewport.name}`);
              }
            }
            await page.getByRole('button', { name: "I'm ready", exact: true }).click();
            const confirmed = page.getByRole('button', { name: "You're ready", exact: true });
            await confirmed.waitFor();
            if (!(await confirmed.isDisabled()))
              throw new Error('Confirmed readiness action must be disabled');
            // PID-418: the viewer's row says it; the footer no longer counts.
            await page
              .getByTestId('new-table-seat-south')
              .getByText('Ready', { exact: true })
              .waitFor();
          }
          if (pageErrors.length) {
            throw new Error(`${testCase.name} interaction errors: ${pageErrors.join(' | ')}`);
          }
          const timing = {
            id: `${viewport.name}/${testCase.name}`,
            ms: Math.round(performance.now() - started),
          };
          timings.push(timing);
          console.log(`ui-case ${(timing.ms / 1000).toFixed(2)}s ${timing.id}`);
        } finally {
          await page.close();
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
    if (process.env.UI_REPORT_PATH) {
      await mkdir(dirname(process.env.UI_REPORT_PATH), { recursive: true });
      await writeFile(process.env.UI_REPORT_PATH, JSON.stringify(timings, null, 2) + '\n');
    }
  }

  console.log(`ui-grammar ok: ${timings.length} captures and geometry checks`);
  timings.forEach(({ id }) => console.log(`  ${id}`));
}

main().catch((error) => {
  console.error(
    `UI grammar verification failed. Start Expo web first (MOBILE_BASE_URL=${baseUrl}).`
  );
  console.error(error);
  process.exit(1);
});
