import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { TRICK_SWEEP_ENABLED } from '../src/game/canvas/animationTiming.ts';
import { partitionCases, verifyCoverage } from './ui-shards.mjs';
import {
  assertInsideViewport,
  assertMinimumTouchTargets,
  assertTeamLayout,
  getStableBox,
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
const ageGateFixture = JSON.stringify({
  state: { ageBand: '18_plus', termsVersion: '1' },
  version: 0,
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
        open: "Recent table actions. Opens this hand's log.",
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
    testId: 'player-profile-modal',
    authenticated: true,
  },
  ...['profile', 'remove', 'block'].map((state) => ({
    name: `friends-${state}`,
    path: '/friends?fixture=list',
    testId: state === 'profile' ? 'player-profile-modal' : 'friend-sheet',
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
  ...['playing', 'game_over'].map((phase) => ({
    name: `block-profile-${phase}`,
    path: `/table-dev?phase=${phase}&role=player`,
    testId: 'player-profile-modal',
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
  {
    name: 'block-profile-guest',
    path: '/table-dev?phase=game_over&role=player',
    testId: 'player-profile-modal',
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
  ...['en', 'sv'].flatMap((locale) =>
    (locale === 'en'
      ? ['profile', 'empty', 'present', 'uploading', 'saved', 'error', 'remove']
      : ['present', 'error']
    ).map((state) => ({
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
  {
    name: 'photo-sheet-guest',
    path: '/profile',
    testId: 'badge-sheet',
    authenticated: true,
    authFixture: guestAuthFixture,
    open: 'Your badges',
    photo: 'guest',
  },
  { name: 'settings', path: '/settings', testId: 'settings-screen', authenticated: true },
  // PID-295: Marcel's welcome and Settings → Send feedback, in both languages.
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
      path: `/ui-dev?state=settings&fixture=no-mail&locale=${locale}`,
      testId: 'settings-screen',
      locale,
      feedback: true,
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
    testId: 'update-notice',
    authenticated: true,
  },
  {
    name: 'update-notice-home-guest',
    path: '/home?fixture=update-notice&safeArea=island',
    testId: 'update-notice',
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
  { name: 'league', path: '/league', testId: 'league-screen', authenticated: true },
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
  ...['method', 'login', 'preview', 'password', 'rename', 'already-claimed'].map((fixture) => ({
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
  { name: 'auth-sheet', path: '/auth-flow-dev', testId: 'auth-flow-dev' },
  { name: 'forgot-password', path: '/(auth)/forgot-password', testId: 'auth-window' },
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
  ].map((fixture) => ({
    name: `new-table-${fixture}`,
    path: `/ui-dev?state=new-table&fixture=${fixture}`,
    testId:
      ['opened', 'ready', 'guest', 'declined'].includes(fixture) || fixture.startsWith('live-')
        ? 'waiting-table'
        : 'new-table-screen',
    newTableFixture: fixture,
  })),
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
  ...['right', 'left', 'middle'].map((position) => ({
    name: `table-play-${position}`,
    path: `/table-dev?fixture=play-motion&autoplay=false&play=${position}${position === 'left' ? '&reply=burst' : ''}`,
    testId: 'seat-north',
    playPosition: position,
  })),
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
  {
    name: 'table-hand-they-set',
    path: '/table-dev?phase=playing&hand=they-set',
    testId: 'hand-result',
  },
  // PID-221: the ticker at its fullest, long names included, stays clear of the
  // plaque and the North seat; the hand log opens from it. Small phones leave
  // the ticker out (PID-229).
  {
    name: 'table-ticker',
    path: '/table-dev?phase=playing&ticker=full&names=long&count=on',
    testId: 'ticker-line-bid-4-south',
    protectNorthSeat: true,
    skipViewports: ['compact-landscape'],
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
  // chip tucks behind its avatar, so its name keeps its first letters.
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
    open: "Recent table actions. Opens this hand's log.",
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
  // PID-267: the bots bid while the cards are still being dealt. Until the
  // deal ends no seat and no log line shows a bid; then all three show.
  {
    name: 'table-bid-during-deal',
    path: '/table-dev?phase=bidding&role=player&deal=true&bids=round&count=on',
    testId: 'bidding-window',
    dealHold: true,
    bidLines: { west: 'Passed', north: 'Bid 7', east: 'Bid 9 · high' },
    viewports: { 'compact-landscape': { width: 640, height: 360 } },
  },
  // PID-220: with count help on, the plaque's bid line carries the bidders'
  // count and "Last trick" sits under it, clear of every seat, also on the
  // small phones that leave the ticker out. Marcel is out of trumps: dimmed,
  // "Out", the two cards folded face down on the felt.
  {
    name: 'table-count-help',
    path: '/table-dev?phase=playing&role=player&out=one&count=on',
    testId: 'last-trick',
    countHelp: { bidder: 'Jocke', line: 'bid 6', out: ['west'], folded: ['west'] },
  },
  {
    name: 'table-last-trick',
    path: '/table-dev?phase=playing&role=player&out=one&count=on',
    open: 'Last trick, trick 2',
    testId: 'last-trick-cards',
  },
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
  ...['system', 'en', 'sv'].map((language) => ({
    name: `locale-${locale}-settings-${language}`,
    path: `/ui-dev?state=settings&locale=${locale}&language=${language}&deviceLocale=${locale}-FI`,
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
      // Public player names deliberately ellipsize; localized sentences may not.
      .filter(
        (node) =>
          !['Alexandria the Long-Named Player', 'AlexandriaLongName'].includes(node.textContent)
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
        ? 'Välj trumf'
        : testCase.name.endsWith('-hand-selection')
          ? 'Välj din hand'
          : null;
    if (expected) await page.getByText(expected, { exact: true }).waitFor();
  }
  if (testCase.language) {
    const group = page.getByTestId('settings-language');
    const labels = [
      testCase.locale === 'sv' ? 'Enhetens språk' : 'System language',
      'English',
      'Svenska',
    ];
    const selected = ['system', 'en', 'sv'].indexOf(testCase.language);
    const groupBox = await group.boundingBox();
    for (const [index, label] of labels.entries()) {
      const radio = group.getByRole('radio', { name: label, exact: true });
      const box = await radio.boundingBox();
      assert.ok(box.height >= 48, `${label}: 48pt target`);
      assert.ok(
        box.x >= groupBox.x && box.x + box.width <= groupBox.x + groupBox.width,
        `${label}: radio must stay within the language Surface`
      );
      assert.equal(await radio.getAttribute('aria-checked'), String(index === selected));
    }
    if (testCase.language === 'system') {
      await group
        .getByText(
          `${testCase.locale === 'sv' ? 'Just nu' : 'Currently'}: ${testCase.locale === 'sv' ? 'Svenska' : 'English'}`,
          { exact: true }
        )
        .waitFor();
    }
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
    await page.goto(`${baseUrl}/device-settings?locale=sv&language=sv&deviceLocale=sv-FI`);
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
      await assertAbovePlayerHand(page, testCase.name, box, viewport);
      await assertBidGridLayout(page, viewport, testCase.locale);
    }

    if (testCase.name === 'table-playing') {
      await assertSeatPlacement(page, viewport);
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

// A wood button's keyline stays inside its rim and its label inside the face,
// so nothing is cut where the platform clips (PID-212).
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
    return;
  }

  const sheet = page.getByTestId('badge-sheet');
  await sheet
    .getByText(guest ? 'Your badges' : sv ? 'Din bild och ring' : 'Your photo and ring', {
      exact: true,
    })
    .waitFor();
  await sheet.getByTestId('badge-options').waitFor();
  await sheet.getByTestId('badge-done').waitFor();
  if (guest) {
    for (const id of [
      'photo-actions',
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
    await sheet.getByTestId('photo-actions').waitFor();
    const primaryId = photo === 'remove' ? 'photo-confirm' : 'photo-change';
    await sheet.getByTestId(primaryId).waitFor();
    assert.equal(
      await sheet.getByTestId(photo === 'remove' ? 'photo-change' : 'photo-confirm').count(),
      0,
      `${name}: removal confirmation replaces, not adds to, the primary action`
    );
    if (['empty', 'present', 'saved'].includes(photo)) {
      const label =
        photo === 'empty'
          ? sv
            ? 'Lägg till bild'
            : 'Add photo'
          : sv
            ? 'Byt bild'
            : 'Change photo';
      await sheet.getByTestId(primaryId).getByText(label, { exact: true }).waitFor();
    }
    if (['present', 'saved'].includes(photo)) {
      await sheet
        .getByTestId('photo-remove')
        .getByText(sv ? 'Ta bort bilden' : 'Remove photo', { exact: true })
        .waitFor();
    }
    if (photo === 'empty')
      assert.equal(await sheet.getByTestId('photo-remove').count(), 0, `${name}: no empty removal`);
    if (photo === 'saved') {
      await sheet
        .getByTestId('photo-feedback')
        .getByText(sv ? 'Bilden är sparad' : 'Photo saved', { exact: true })
        .waitFor();
    }
    if (photo === 'error') {
      await sheet.getByTestId('photo-feedback').waitFor();
      assert.ok(
        (await sheet.getByTestId('photo-feedback').innerText()).trim(),
        `${name}: error copy`
      );
      await sheet
        .getByTestId('photo-retry')
        .getByText(sv ? 'Försök igen' : 'Try again', { exact: true })
        .waitFor();
    }
    if (photo === 'remove') {
      await sheet
        .getByTestId('photo-confirm')
        .getByText(sv ? 'Ta bort bilden' : 'Remove photo', { exact: true })
        .waitFor();
      await sheet.getByTestId('photo-cancel').waitFor();
    }
    if (photo === 'uploading') {
      const progress = sheet.getByTestId('photo-progress');
      await progress.waitFor();
      assert.equal(await progress.getAttribute('role'), 'progressbar');
      assert.ok(await progress.getAttribute('aria-label'), `${name}: progress is labelled`);
      assert.equal(await sheet.getByTestId('photo-change').getAttribute('aria-disabled'), 'true');
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
    assert.deepEqual(wood, [primaryId], `${name}: exactly one wood action`);
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

// PID-295: Send feedback is a row in the Settings list; when no mail app opens,
// the address is there to copy.
async function assertFeedbackRow(page, testCase, viewport) {
  if (!testCase.feedback) return;
  const sv = testCase.locale === 'sv';
  const row = page.getByTestId('settings-feedback');
  await row.scrollIntoViewIfNeeded();
  await row.getByText(sv ? 'Skicka synpunkter' : 'Send feedback', { exact: true }).waitFor();
  await row
    .getByText(sv ? /^Skriv till marcel@pidro\.online\./ : /^Write to marcel@pidro\.online\./)
    .waitFor();
  for (const name of [sv ? 'Skriv' : 'Write', sv ? 'Kopiera adressen' : 'Copy address']) {
    const box = await row.getByRole('button', { name, exact: true }).boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, `${testCase.name}: ${name} is a 44pt target`);
    assertInsideViewport(`${testCase.name} ${name}`, box, viewport);
  }
  assertInsideViewport(`${testCase.name} row`, await row.boundingBox(), viewport);
}

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
      const face = keyline.firstElementChild.getBoundingClientRect();
      const label = rim.getAttribute('aria-label');
      if (keyBox.bottom > rimBox.bottom - pad + 0.5) found.push(`${label}: keyline below rim`);
      for (const text of keyline.querySelectorAll('div[dir="auto"]')) {
        const box = text.getBoundingClientRect();
        if (box.top < face.top - 0.5 || box.bottom > face.bottom + 0.5) {
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
  if (!testCase.path.includes('claim-classic') && !testCase.path.includes('classic-forgot')) return;
  const sv = testCase.locale === 'sv';
  const screen = page
    .getByTestId(
      testCase.path.includes('claim-classic') ? 'claim-classic-screen' : 'classic-forgot-screen'
    )
    .last();
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
  if (testCase.path.includes('fixture=preview')) {
    assert.equal(await screen.locator('input').count(), 0, 'identity check has no inputs');
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
  if (testCase.name === 'classic-code') {
    await screen.getByRole('link', { name: 'Send again', exact: true }).waitFor();
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

// The update notice floats over the shell (faked island insets: 59 top, 34 bottom).
// Home's controls reach the bottom, so there it sits under the header, in the logo
// stage; it must cover nothing, stay clear of the tab pill, and move nothing when it
// goes. Restart must go busy on the first tap and stay that way. Elsewhere it floats
// above the bottom inset and every scrolling screen scrolls its last row clear of it.
async function assertUpdateNotice(page, name, viewport) {
  const notice = page.getByTestId('update-notice');
  const guestScreen = {
    'update-notice-friends-guest': 'Friends',
    'update-notice-home-guest': 'Home',
  }[name];
  if (guestScreen) {
    await getStableBox(notice, page);
    await assertNothingUnderNotice(page, `${guestScreen} (guest)`, viewport);
    return;
  }
  if (name !== 'update-notice') return;
  const box = await getStableBox(notice, page);
  const pill = await page.getByTestId('tab-pill').boundingBox();
  assert.ok(pill && !boxesOverlap(box, pill), `update notice covers the tab pill`);
  await assertNothingUnderNotice(page, 'Home', viewport);
  const restart = page.getByRole('button', { name: 'Restart', exact: true });
  const dismiss = page.getByRole('button', { name: 'Dismiss', exact: true });
  for (const [label, control] of [
    ['Restart', restart],
    ['Dismiss', dismiss],
  ]) {
    const target = await getStableBox(control, page);
    assert.ok(target.width >= 44 && target.height >= 44, `${label} is a 44pt target`);
  }
  const contentBoxes = () =>
    page.getByTestId('home-screen').evaluate((screen) =>
      [screen, ...screen.querySelectorAll('[role="button"], [role="img"]')]
        .filter((element) => !element.closest('[data-testid="update-notice"]'))
        .map((element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return [x, y, width, height].map(Math.round).join(',');
        })
    );
  const withNotice = await contentBoxes();
  await restart.click();
  await restart.locator('[role="progressbar"]').waitFor();
  assert.ok(await restart.isDisabled(), 'a busy Restart cannot be tapped again');
  await dismiss.click();
  await notice.waitFor({ state: 'detached' });
  assert.deepEqual(await contentBoxes(), withNotice, `the notice moved Home in ${viewport.name}`);

  await page.goto(new URL('/settings?fixture=update-notice&safeArea=island', baseUrl).href);
  await notice.waitFor();
  await waitForScreenshotReady(page);
  const shown = await getStableBox(notice, page);
  assert.ok(shown, `update notice missing on Settings in ${viewport.name}`);
  assert.ok(shown.y + shown.height <= viewport.height - 34, `update notice above the bottom inset`);
  const lastRow = await page.getByTestId('settings-screen').evaluate((scroller) => {
    scroller.scrollTop = scroller.scrollHeight;
    return scroller.firstElementChild.lastElementChild.getBoundingClientRect().bottom;
  });
  assert.ok(lastRow <= shown.y, `Settings cannot scroll clear of the notice in ${viewport.name}`);
  await assertNothingUnderNotice(page, 'Settings', viewport);
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
  if (name.startsWith('block-profile-')) {
    await page.getByText('mfios1', { exact: true }).last().waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Block', exact: true }).count(),
      name === 'block-profile-guest' ? 0 : 1
    );
    return;
  }
  if (!name.startsWith('friends-')) return;
  if (name === 'friends-link-profile') {
    const profile = page.getByTestId('player-profile-modal');
    const add = profile.getByRole('button', {
      name: swedish ? 'Lägg till Nora' : 'Add Nora',
      exact: true,
    });
    await profile.getByText('Nora', { exact: true }).waitFor();
    await add.click();
    await profile.getByText(swedish ? 'Skickad' : 'Sent', { exact: true }).waitFor();
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
          ? '7 av dina Classic-vänner är inte här ännu'
          : '7 of your Classic friends aren’t here yet',
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
        ? 'Kom och spela Pidro med mig 🃏 https://www.pidro.online/'
        : 'Come play Pidro with me 🃏 https://www.pidro.online/'
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
        ? 'Kom och spela Pidro med mig: https://pidro.online'
        : 'Come play Pidro with me: https://pidro.online'
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
            '38 av dina Classic-vänner är inte här ännu',
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
          'friends-profile': ['Spelarprofil', 'Nora'],
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
            '38 of your Classic friends aren’t here yet',
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
          'friends-profile': ['Player profile', 'Nora'],
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
          ? 'Kom och spela Pidro med mig: https://pidro.online'
          : 'Come play Pidro with me: https://pidro.online'
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
          '38 av dina Classic-vänner är inte här ännu',
        ]
      : [
          '4 friends · 3 online',
          'Want to be friends',
          'Online now',
          'Not online',
          'Waiting for an answer',
          'Request sent 2 days ago',
          '38 of your Classic friends aren’t here yet',
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

async function assertHomeProfile(page, testCase, viewport) {
  const name = testCase.name;
  if (name === 'profile-friends-guest') {
    await page
      .getByTestId('auth-sheet')
      .getByRole('button', { name: 'Not now', exact: true })
      .click();
    await page.waitForURL((url) => url.pathname.endsWith('/profile'));
    await page.getByTestId('profile-friends-row').waitFor();
    assert.equal(await page.getByTestId('tab-pill').count(), 0);
  }
  if (name === 'home-waiting' || name === 'home-waiting-guest') {
    const count = name.endsWith('-guest') ? '2' : '3';
    assert.equal(await page.getByTestId('home-waiting-count').innerText(), count);
    assertInsideViewport(
      name,
      await page.getByTestId('home-waiting-count').boundingBox(),
      viewport
    );
    if (name.endsWith('-guest')) assert.equal(await page.getByTestId('tab-pill').count(), 0);
    else assert.equal(await page.getByTestId('friends-invitation-count').innerText(), count);
  }
  if (name === 'home' || name === 'home-guest')
    assert.equal(await page.getByTestId('home-waiting-count').count(), 0);
  if (name === 'profile-friends' || name === 'profile-friends-zero') {
    const row = page.getByTestId('profile-friends-row');
    const count = name.endsWith('-zero') ? 0 : 6;
    assert.equal(await row.getAttribute('aria-label'), `Friends, ${count}`);
    assertInsideViewport(name, await row.boundingBox(), viewport);
    await row.click();
    await page.getByTestId('friends-profile-back').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('from'), 'profile');
    await page.getByTestId('friends-profile-back').click();
    await page.waitForURL((url) => url.pathname.endsWith('/profile'));
    await page.getByTestId('profile-friends-row').waitFor();
  }
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
  await page.getByRole('button', { name: 'Account and sign-in', exact: true }).click();
  await page.waitForURL((url) => url.pathname.endsWith('/settings'));
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  await page.getByText('Delete your account?', { exact: true }).waitFor();
  const classicSentence = page.getByText(/Your Classic account stays in Classic/);
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

async function assertPlayMotion(page, position) {
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
  assert.equal(await page.getByTestId('rendered-played-card-count-4').count(), 1);
}

async function assertCardCollection(page, winner, reduced) {
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
        testCase.locale === 'sv'
          ? 'Alla tre botarna spelar samma ärliga spel: de bjuder vad handen är värd, räknar trumf och stöttar sin partner.'
          : 'All three bots play the same honest game: they bid what the hand is worth, count trumps and back up their partner.',
        { exact: true }
      )
      .waitFor();
    assert.equal(await card.getByRole('button').count(), 1, 'bots have Close, no social actions');
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
    await card.getByRole('button').click();
    await card.waitFor({ state: 'detached' });
    await entry.locator('svg').first().click();
    await copy.waitFor();
    await waitForScreenshotReady(page);
  } else {
    const line = page
      .getByTestId(testCase.testId)
      .getByText(testCase.thinkingText, { exact: true });
    await line.waitFor();
    assertInsideViewport('thinking line', await getStableBox(line, page), viewport);
    assert.equal(
      await line.evaluate((node) => node.scrollWidth > node.clientWidth + 1),
      false,
      'thinking line fits the nameplate'
    );
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
  if (testCase.playedCount) {
    assert.ok(played.some((s) => s.key.endsWith('north-hearts_6')));
    const seat = Object.keys(testCase.fold)[0];
    assert.ok(
      played.some((s) => s.key.endsWith(`${seat}-hearts_9`) && s.leading),
      '9♥ keeps its winning glow'
    );
    if (testCase.completedFold) {
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
// leaves the hand, the bids and North's played card uncovered. Not now closes it.
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
  const bottom = box.y + box.height;
  const north = await getStableBox(page.getByTestId('trick-north-top').first(), page);
  assert.ok(
    bottom <= north.y + 0.5,
    `${testCase.name}: clears North's played card in ${viewport.name}`
  );
  await assertAbovePlayerHand(page, testCase.name, box, viewport);
  for (const button of await page.getByTestId('bidding-window').getByRole('button').all()) {
    const bid = await getStableBox(button, page);
    assert.ok(!boxesOverlap(box, bid), `${testCase.name}: clears the bids in ${viewport.name}`);
  }
  await card.getByRole('button', { name: 'Not now', exact: true }).click();
  await card.waitFor({ state: 'detached' });
}

async function assertAbovePlayerHand(page, name, box, viewport) {
  const handBoundary = page.getByTestId('player-hand-top').first();
  await handBoundary.waitFor({ state: 'attached', timeout: 20_000 });
  const handBox = await getStableBox(handBoundary, page);
  if (!handBox) throw new Error(`${name} player-hand boundary has no geometry`);
  const handTop = handBox.y;
  const minimumClearance = viewport.height >= viewport.width ? 28 : 8;

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
    if (centerOffset > 2) {
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

  if (portrait) {
    const utilityDock = page.getByTestId('table-utility-dock').first();
    await utilityDock.waitFor({ state: 'visible', timeout: 20_000 });
    const dockBox = await getStableBox(utilityDock, page);
    if (!dockBox) throw new Error('portrait utility dock has no geometry');
    assertInsideViewport('portrait utility dock', dockBox, viewport);
    if (Math.abs(dockBox.y + dockBox.height - viewport.height) > 2) {
      throw new Error(`portrait utility dock is not bottom-anchored: ${JSON.stringify(dockBox)}`);
    }
    if (seats.south.y + seats.south.height > dockBox.y - 4) {
      throw new Error(
        `seat-south overlaps the portrait utility dock: south=${JSON.stringify(seats.south)} dock=${JSON.stringify(dockBox)}`
      );
    }
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

  if (Math.abs(seats.east.y - seats.west.y) > 2 || seats.east.y <= seats.north.y + 12) {
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
    ['1', '12', '99', '99+', '3', '99+'],
    'A zero count hides; past 99 reads 99+'
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

async function main() {
  const cases = selectCases();
  const matrix = selectViewports().flatMap((viewport) =>
    cases
      .filter((testCase) => {
        if (
          (testCase.welcome || testCase.name.startsWith('age')) &&
          ['small-portrait', 'compact-portrait', 'tablet-portrait'].includes(viewport.name)
        )
          return true;
        if (
          testCase.words ||
          testCase.ownPace ||
          testCase.homeProfile ||
          testCase.details ||
          testCase.scores ||
          testCase.botVoice ||
          testCase.photo
        )
          return ['portrait', 'small-portrait', 'landscape', 'tablet-portrait'].includes(
            viewport.name
          );
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
        deviceScaleFactor: 1,
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
        // Reuse CI's existing tablet shards without resizing any other screen.
        const caseViewport = testCase.lobbyFixture
          ? (viewport.lobbyViewport ?? viewport)
          : testCase.viewports?.[viewport.name]
            ? { ...viewport, ...testCase.viewports[viewport.name] }
            : viewport;
        await page.setViewportSize({ width: caseViewport.width, height: caseViewport.height });
        await page.addInitScript(
          ({ ageGate, authenticated, fixture, pendingInvite, welcomeSeen, photoLocale }) => {
            globalThis.localStorage.setItem('age-gate-storage', ageGate);
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
            photoLocale: testCase.photo ? (testCase.locale ?? 'en') : null,
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
        if (testCase.name === 'game-away' || testCase.name.startsWith('friend-notice-')) {
          // These deterministic fixtures need no server, even beside a live e2e backend.
          await page.route('**/api/v1/**', (route) => route.abort());
        }
        if (testCase.playerProfile) {
          await page.route('**/api/v1/profiles/p-west', (route) =>
            route.fulfill({
              json: {
                data: {
                  user_id: 'p-west',
                  username: 'mfios1',
                  display_name: 'mfios1',
                  avatar_url: null,
                  bio: null,
                  classic: null,
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
          testCase.photo ||
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
            await assertPlayMotion(page, testCase.playPosition);
          }
          if (testCase.sweepWinner) {
            await assertCardCollection(page, testCase.sweepWinner, testCase.reducedMotion);
          }
          if (testCase.verifyDealerCutCards) {
            await assertDealerCutCards(page, viewport);
          }
          if (testCase.verifyDealerSelection || testCase.verifyDealerPrivacy) {
            await assertDealerSecondDeal(page, testCase, viewport);
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
            testCase.testId === 'friend-sheet'
          ) {
            await page.getByTestId(testCase.testId).waitFor();
            await waitForScreenshotReady(page);
          }
          if (testCase.appUpdate) await assertAppUpdate(page, testCase);
          if (testCase.name.startsWith('friend-notice-')) {
            await page.getByTestId('friend-notice').waitFor();
            await waitForScreenshotReady(page);
          }
          await assertAccountButtonsStayPut(page, testCase.name, answerProfile);
          await assertTargetGeometry(page, testCase, caseViewport);
          await assertBidLines(page, testCase, caseViewport);
          await assertCrew(page, testCase);
          await assertBotVoice(page, testCase, caseViewport);
          await assertPlayLines(page, testCase, caseViewport);
          if (testCase.locale && testCase.path.includes('game_over')) {
            await page
              .getByTestId('victory-confetti')
              .waitFor({ state: 'detached', timeout: 7000 });
          }
          await assertCountHelp(page, testCase, caseViewport);
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
          await assertPhotoSheet(page, testCase, caseViewport);
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
            if (testCase.open) {
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
          // The welcome covers Home on purpose until Let's play.
          if (!testCase.welcome) await assertHomeHeaderClear(page, testCase.path, caseViewport);
          await assertHomeProfile(page, testCase, caseViewport);
          await assertLocalization(page, testCase, caseViewport);
          if (testCase.lobbyFixture !== 'locked') await assertLobbyPresentation(page, testCase);
          await assertFriendsPresentation(page, testCase.name);
          await assertCreationPresentation(page, testCase);
          await assertPasswordKeypad(page, testCase, caseViewport);
          await assertSeatPicker(page, testCase, caseViewport);
          await assertAuthFormInteractions(page, testCase.name, viewport);
          await assertWelcomeGuestInteractions(page, testCase.name, viewport);
          await assertWelcomeSettingsInteractions(page, testCase.name);
          await assertHomeGuestInteractions(page, testCase.name);
          await assertFriendNotice(page, testCase.name, caseViewport);
          await assertTableInvitation(page, testCase, caseViewport);
          await assertUpdateNotice(page, testCase.name, caseViewport);
          await assertTableMessageReadable(page, testCase.name, caseViewport);
          await assertClassicLogin(page, testCase, viewport);
          await assertDeleteAccountConfirmation(page, testCase.name, screenshotDir);
          await assertAuthSheetKeepsTyping(page, testCase.name);
          await assertSwitchInteractions(page, testCase.name, screenshotDir);
          await assertTableDetails(page, testCase, caseViewport);
          await assertTeams(page, testCase);
          await assertRowControls(page, testCase.name, screenshotDir);
          await assertFriendComponents(page, testCase.name, screenshotDir);
          await assertRuleInteractions(page, testCase, viewport, screenshotDir);
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
            await page.getByText('3 of 4 ready', { exact: true }).waitFor();
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
