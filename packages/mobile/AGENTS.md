# Pidro Mobile - Agent Guide

This file contains information for AI coding assistants working on the Pidro mobile client.

## Project Overview

React Native mobile app using Expo Router for a multiplayer card game. Connects to a Phoenix/Elixir backend via REST API and Phoenix Channels (WebSocket).

## Shipping

Prove it, push to `main`; a green `main` publishes the beta update over the air. The
steps, the rollback command and the load-bearing paths that need an independent review
before a push are in the root [`AGENTS.md`](../../AGENTS.md).

## Testing and proof (required)

Read [`../../docs/testing.md`](../../docs/testing.md) before choosing checks. It is
the testing policy, including risk triggers, concrete evidence and release coverage.

- **Prove the changed behavior, not just green tests.** Name the claim, reproduce a
  bug before the fix, rerun the same case after, and check a nearby unchanged control.
  Inspect captures/logs and report the observed state. Disclose fixture mocks and
  skipped boundaries. Missing required evidence means verification is incomplete.
- **Iterate narrowly.** Run the affected Bun test file, named `UI_CASES` and
  `UI_VIEWPORTS`, or one relevant journey. Expand for shared-code, integration,
  responsive or native risks. CI owns the selected regression sweep; do not repeat
  the full screenshot inventory or full gameplay after every edit/review/rebase.
- **Browser ≠ native.** Expo-web Chromium proves browser behavior only, including
  phone/tablet/inset-named fixtures. Native modal/keyboard handoffs, real safe areas,
  gestures, rotation, accessibility, worklets/GPU, native SDKs and lifecycle changes
  require the affected path on iOS (simulator/device as appropriate). If unavailable,
  report the native evidence blocker; do not call the feature complete.
- **Freeze Metro inputs while capturing.** Finish edits, formatting and rebasing,
  warm the route, then run checks with no edits/checkouts/install/cache-clears in
  flight. If work must continue, serve a separate frozen worktree on a distinct port.
  A reload/restart during a run invalidates the affected evidence; diagnose, freeze,
  and rerun that selection, not automatically the whole matrix.
- **Timing bugs get forced-order regressions.** Wait for the actual final state,
  not a larger sleep. Capture the old failure and new result with the same delay or
  event order. Keep reset/reconnect/error controls; don't buy green with retries or
  weaker assertions. See the focused Home-tick and readiness examples in the policy.

## Current UI Direction: Design System v2 (LOCKED — 2026-09-09)

The DS v2 bevel system is the canonical UI language. **Every new screen and every
restyle uses it.** The constitution lives in `src/design/README.md` — read it before
building UI. Do not invent one-off styles, raw hex colors, or alternative component
treatments in screens.

- **Tokens**: `src/design/tokens.ts` (`PidroBevel` is the bevel palette; gradients and
  boxShadow strings included). Screens never hardcode colors, radii, or shadows.
- **Primitives** (in `src/components/ui/` and `src/components/home|auth/`):
  `BevelButton` (all CTAs; `material` wood/glass, `size` sm/md/lg/hero/icon),
  `BevelPressable`/`BevelSurface` (custom beveled controls/surfaces), `Input`
  (carved-in wells), `PidroText`, `Surface`, `ScreenShell`, `DecisionWindow`, `Modal`,
  `PressableFX`, `TabPill` (the floating shell pill), `LogoGlow`, `AuthProviderButtons`, `AuthSheet`,
  `KeepProgressPrompt`, `Icon` (never inline `<Svg><Path>` in a screen), and the
  progression HUD — `PlayerAvatar`, `RatingPlaque`, `LeagueProgress`, `CtaBadge`
  (sheet: `/ui-dev?state=progression`). Legacy `Button` is utility-only on old screens — do not add
  call sites; migrate to `BevelButton` when touching a screen. `MenuAction` and
  `PrimaryButton` are compatibility-only.
- **The living gallery** is `/ui-dev?state=components` — it is screenshotted by CI and
  pixel-diffed against `test/ui-baselines/`. When you change a token or primitive, the
  gallery and every consuming screen drift together; refresh baselines from the CI run
  (`bun run ui:baselines <runId>`) as the documented acceptance step.
- **Design exploration** happens on the Pidro Design System v2 canvas
  (claude.ai/code/artifact/0e088d48-ae23-430d-aadd-88cb3da5b5af). Flow: canvas
  (explore) → tokens/primitives (implement) → gallery + baselines (enforce) → screens
  (consume). Changes trickle down; they are never forked per-screen.
- The separate `packages/web` client is not the visual reference for the React Native
  client. Verify mobile UI in the React Native app (native or its Expo web rendering).
- **Verify overlays/clearances on a simulator, not just web** — web has zero safe-area
  insets. Fast loop: `just table-sim "iPhone 17 Pro" bidding`, or with Metro already
  running `xcrun simctl openurl booted "exp://127.0.0.1:8081/--/table-dev?phase=bidding"`;
  screenshot with `xcrun simctl io booted screenshot`. Every fixture route and its
  params are in `docs/FIXTURE-ROUTES.md`; the web/native division of labour is in
  `docs/WEB-PARITY.md`.
- **Rotation is scriptable**: `bash scripts/table-matrix.sh rotate [left|right] [phase]`.
  It rotates via the Simulator's Device menu (AppleScript) and then re-opens the deep
  link, because Expo Go keeps `useWindowDimensions` stale until the route remounts —
  that staleness is what made rotation look unscriptable. Note `simctl io screenshot`
  always captures device-NATIVE orientation, so a landscape capture still comes out
  portrait-shaped; rotate the PNG, not the expectation. Production builds are unaffected.
- **Driving the simulator** (tap/type/assert) is Maestro, registered as an MCP
  server in `.mcp.json` at the monorepo root — use `inspect_screen` to read the
  real accessibility labels, then `run` a flow from `test/flows/`. Never tap by
  coordinate. Full guide and the four gotchas (Expo Go `appId`, mandatory
  `stopApp`, `extendedWaitUntil` over `assertVisible`, labels as selectors) are
  in `docs/DEVICE-FLOWS.md`.
- **A device flow is expensive** (~30s of simulator + bundle). Spend it on
  safe-area clearance, touch targets, gestures and rotation. Grammar, wrapping
  and containment stay on `bun run test:ui`.
- **`/table-dev` inherits the device's real insets.** `?safeArea=island|android|
android-gesture` only _fakes_ them, so a browser can approximate a device. Never add
  `safeArea=` to a simulator check — it would hide the clearance you are there to see.
- Keep behavior fixes focused; visual changes ride the DS, not ad-hoc styling.
- **Native modals need their own `SafeAreaProvider` inside the modal root.** The
  app provider is not a native ancestor across that boundary. Never use cached
  initial window metrics for a remounting modal. Follow the safe-area rules in
  `src/design/README.md`; check all four edges and both landscape directions.
  Zero-inset browser screenshots cannot certify notch/camera or system-bar clearance.

## Architecture Principle: Dumb Client, Smart Server

**The server is the single source of truth.** This is a card game with an authoritative server architecture.

### Key Rules

1. **Server owns all game state** - The client never computes game logic (valid moves, scoring, turn order, etc.)
2. **Client sends intents, not results** - Client says "I want to play this card", server validates and responds with new state
3. **Client renders what server tells it** - The UI is a "privileged spectator" of the game state
4. **Never trust client data** - All validation happens server-side

### What the Client Does

- Sends user intents/actions to server (play card, place bid, etc.)
- Receives and renders game state from server
- Handles UI/UX (animations, transitions, user feedback)
- Manages local-only state (UI preferences, which modal is open, etc.)

### What the Client Does NOT Do

- Validate if a move is legal (server does this)
- Calculate scores or determine winners
- Manage turn order or game phase transitions
- Store authoritative game state (only caches what server sends)

### When to Push Back

If a feature request implies the client should:

- Compute game rules or validation logic
- Determine game outcomes
- Make decisions that affect game state

...then push back and suggest it belongs on the server.

**Reference**: [Gabriel Gambetta - Client-Server Game Architecture](https://www.gabrielgambetta.com/client-server-game-architecture.html)

> "The game state is managed by the server alone. Clients send their actions to the server. The server updates the game state periodically, and then sends the new game state back to clients, who just render it on the screen."

Note: Unlike fast-paced games, Pidro is turn-based, so we don't need client-side prediction or lag compensation. This makes our architecture simpler - pure request/response with server authority.

## Purchases, ads and push

Three thin adapters over the native SDKs that store build 3.3.0 carries:
`src/features/premium/purchases.ts` (RevenueCat), `src/features/ads/ads.ts` (rewarded
AdMob) and `src/features/push/push.ts` (expo-notifications). Each is a no-op on web
and when its keys are missing; env vars, EAS environments and the prebuild check are
in [`../../docs/native-sdks.md`](../../docs/native-sdks.md). The server owns `premium`
and the decision to show an ad: nothing in the client reads CustomerInfo to unlock
anything, and the client shows an ad only when the server asks for one. No ATT prompt
and no notification-permission prompt exist until a ticket names the moment.

## Tech Stack

- **Framework**: React Native with Expo SDK 54+
- **Package Manager**: Bun
- **Language**: TypeScript (strict mode)
- **Navigation**: Expo Router (file-based routing)
- **Styling**: design tokens + `StyleSheet.create` (canonical for all DS v2 work)
  - Style with `src/design/tokens.ts` values through the DS primitives; use
    `StyleSheet.create` for component styles. Gradients via `gradientBg()` from
    `src/components/ui/Bevel.tsx`; shadows as RN `boxShadow` strings (New Arch).
  - NativeWind/`className` remains only in legacy code paths — do not extend it to
    new components.
- **State Management**:
  - Zustand for client state (auth, settings, UI)
  - TanStack Query for server state (planned)
  - Phoenix Channels for real-time game state
- **Backend**: Phoenix/Elixir server (see PIDRO_PROJECT_OVERVIEW.md)

## Key Commands

```bash
# Development
bun start              # Start Expo dev server
bun ios                # Run on iOS simulator
bun android            # Run on Android emulator

# Code Quality
bun lint               # Lint and check formatting
bun format             # Auto-fix linting and format code

# Testing (root commands run from the repository root)
bun run test:unit      # Root: Bun unit/regression suites in shared/test + mobile/test
bun run test:ui        # Mobile: Expo-web grammar matrix; narrow with UI_CASES/UI_VIEWPORTS
node --test scripts/readiness-e2e.test.mjs  # Mobile: focused Chromium readiness regression

# Clear cache (if styles not updating)
bun expo start -c      # Clear Metro bundler cache
```

## Project Structure

```
app/                    # Expo Router (file-based routing)
  (auth)/              # Auth screens (login, register)
  (tabs)/              # Main app tabs (lobby, games, profile)
  index.tsx            # Initial route with auth redirect
  _layout.tsx          # Root layout
  emergency.tsx        # Emergency reset screen

src/
  api/                 # API client (axios)
  bootstrap/           # App initialization (realtime, etc)
  channels/            # Phoenix Channels (WebSocket)
  components/ui/       # Reusable UI components
  constants/           # App config and constants
  hooks/               # Custom React hooks
  stores/              # Zustand stores
  types/               # TypeScript types
  utils/               # Utility functions
```

## Conventions

### File Naming

- Components: PascalCase (e.g., `Button.tsx`, `UserProfile.tsx`)
- Utilities/Hooks: camelCase (e.g., `useAuth.ts`, `storage.ts`)
- Constants: camelCase files, UPPER_SNAKE exports (e.g., `config.ts` exports `API_CONFIG`)

### Import Aliases

- `@/*` → `src/*`
- `~/*` → Root directory

### Code Style

- Use design tokens and `StyleSheet.create`; `className` is legacy-only (see DS v2 above)
- Prefer `const` over `let`
- Use `useCallback` for functions passed as props
- Extract error handling to utility functions
- Prefix console logs with component/module name: `[Auth]`, `[Socket]`

### State Management

- **Auth state**: `src/stores/auth.ts` (persisted to SecureStore)
- **UI state**: `src/stores/ui.ts` (ephemeral)
- **Server data**: TanStack Query (when implemented)
- **Real-time game state**: Phoenix Channels custom hooks

### Test locations

- Bun unit/regression tests: `test/` and `../shared/test/` (extend existing suites).
- Expo-web geometry/fixture checks: `scripts/verify-*.mjs`; account journeys:
  `e2e/specs/` (Playwright); native simulator flows: `test/flows/` (Maestro).
- Mock only below the boundary being proved. A mocked channel/API fixture cannot
  certify real event ordering, server integration or native SDK behavior.

## Critical Implementation Notes

### NativeWind v4 Setup (Tailwind v3)

1.  **Legacy only**: preserve existing NativeWind behavior when maintaining an old
    surface. New/restyled surfaces follow DS v2 tokens and `StyleSheet.create` above.
2.  **Configuration**:
    - `tailwind.config.js` handles the configuration (v3 syntax).
    - `babel.config.js` includes `nativewind/babel`.
3.  **Note**: ScrollView `contentContainerClassName` IS supported in v4 (via `nativewind/preset`), but verify if it works or use `contentContainerStyle` if issues arise.

**Troubleshooting Styles**:

- If styles aren't applying, run `bun expo start -c` to clear the Metro cache.

### Navigation & Auth Flow

- `app/index.tsx` handles initial routing based on auth state
- Uses `<Redirect />` component (not imperative navigation)
- Auth state managed by Zustand with SecureStore persistence
- Session validation happens in `onRehydrateStorage` callback

### Phoenix Channels

- Socket initialized in `app/_layout.tsx` via `initRealtime()`
- Auto-connects/disconnects based on auth state
- Pauses in background, reconnects in foreground (AppState listener)

### Environment Variables

- Create `.env` from `.env.example`
- All public env vars must be prefixed with `EXPO_PUBLIC_`
- Access via `process.env.EXPO_PUBLIC_*`

## Common Issues

### White Screen

- Check if NativeWind babel preset is configured
- Clear Metro cache: `bun expo start -c`
- Check console for errors

### Navigation Errors

- Don't use imperative navigation in `_layout.tsx` before mount
- Use `<Redirect />` in route components instead

### Auth Issues

- Check SecureStore permissions on device
- Use Emergency Reset screen: `/(emergency)`
- Check session validation in `src/stores/auth.ts`

## Next Steps (Phases 8+)

See `spec/PIDRO_MOBILE_SETUP_PLAN.md` for full roadmap:

- [ ] Phase 8: Lobby UI
- [ ] Phase 9: Room Management
- [ ] Phase 10: Game UI
- [ ] Phase 11: Real-time Gameplay
- [ ] Phase 12: Polish & Testing

## Resources

- [Expo Docs](https://docs.expo.dev)
- [NativeWind](https://www.nativewind.dev)
- [Phoenix Channels JS](https://hexdocs.pm/phoenix/js/)
- [Zustand](https://docs.pmnd.rs/zustand)
