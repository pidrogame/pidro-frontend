# Pidro Mobile Testing

## Test accounts

These are throwaway local-development accounts already used by the mobile test scripts:

| Username    | Password     | Typical use                   |
| ----------- | ------------ | ----------------------------- |
| `mf2`       | `hallohallo` | Browser smoke test            |
| `skiatest1` | `hallohallo` | Default full-game autoplay    |
| `skiatest2` | `hallohallo` | Second multiplayer client     |
| `skiatest3` | `hallohallo` | Additional multiplayer client |

The accounts must exist on the backend selected by the test command. As of July 19, 2026, these username/password combinations are not valid in production; use an existing production account or intentionally register a dedicated production test account there.

## Daily development against production

Run the mobile UI locally while using the production API and game population:

```bash
# From the repository root
just mobile-prod

# Equivalent command from packages/mobile
bun run start:prod
```

This needs only one terminal; a local Phoenix server is not required. Manual actions still write to production, so use a dedicated production account. Do not point `test:smoke` or `autoplay-full-game.mjs` at production unless you intentionally want them to create rooms, leave rooms, and play games there.

To switch back to a local backend, run `just env-lan` from the repository root, start Phoenix with `just backend` in one terminal, and restart Metro with `just mobile` in another.

## Fixture routes

Every dev harness route, its params and the scripted checks are in
[`docs/FIXTURE-ROUTES.md`](docs/FIXTURE-ROUTES.md). What web can and cannot prove
about the native client is in [`docs/WEB-PARITY.md`](docs/WEB-PARITY.md), and
tapping/typing on a real simulator is in
[`docs/DEVICE-FLOWS.md`](docs/DEVICE-FLOWS.md).

## Useful commands

From `packages/mobile`:

```bash
# Visual fixture, no login or backend required
bun run web
# Then open /table-dev?phase=bidding

# Browser/API smoke test. Defaults to mf2 against localhost:4000.
bun run test:smoke

# Full bot game. Defaults to skiatest1 against localhost:4001.
bun scripts/autoplay-full-game.mjs

# Choose another test account or backend.
API_BASE_URL=http://127.0.0.1:4000 \
WS_BASE_URL=ws://127.0.0.1:4000/socket \
bun scripts/autoplay-full-game.mjs --user skiatest2
```

## Host seat decisions (PID-93)

With Expo web running, run `MOBILE_BASE_URL=http://localhost:8081 node scripts/verify-seat-decisions.mjs`.
Optionally set `UI_SHOT_DIR` to capture the phone, compact-landscape and tablet cases.
The dev-only fixture never writes to a backend; Open seat deliberately shows a delayed error.
Use `/table-dev?lifecycle=permanent_bot&feedback=owner&notice=true` to review three decisions
alongside a notice. Add `playerName=Alexandria%20the%20Long-Named%20Player` to check wrapping.

The decision card is an explicit, non-modal overlay: Later preserves the queue; starting
your turn or losing eligibility closes review without choosing an outcome. Its size does
not feed into table geometry. The existing notice reserve and header remain owned by
PID-95/PID-90. Native iOS/Android safe-area, font-scaling and background/rejoin QA is still
required; browser viewports are not device proof.

## Full-game e2e (the CI gate)

`scripts/ci-game-e2e.mjs` plays two complete games against a real backend and
fails if either one doesn't reach game over:

1. **Solo protocol game** — registers a throwaway account, creates a 3-bot
   room, and plays first-legal-action to `game_over` (including the
   `progression_summary` check).
2. **Multiplayer UI game** — a second account creates a room with one open
   seat, logs in through the real UI in headless Chromium, and sits at the
   table while the autoplayer takes the open seat. The server's turn timers
   auto-play the UI seat, so a full game runs in the actual client — recorded
   as `game.webm` with milestone screenshots.

CI runs this in the `Game e2e` job (`.github/workflows/game-e2e.yml`, called by
Frontend CI and by pidro-backend's Deploy workflow before a production deploy): it
checks out `marcelfahle/pidro-backend`, boots Phoenix against a Postgres
service with fast pacing (`LIFECYCLE_BOT_DELAY_MS=60`,
`LIFECYCLE_TURN_TIMER_BID_MS=1200`, …), starts Expo web, and uploads the video
and screenshots as the `game-e2e-artifacts` artifact.

Connection probes and the per-turn pause allowance also run at 1000 ms in CI.
Keeping probes at their production 15 s while turns take 900 ms lets an entire
hand finish and reset its idle count before a pong can confirm the idle player
is reachable. The away-screen assertion must stay enabled.

To run it locally without touching your daily backend on :4000, boot a second
instance with CI pacing and point everything at it:

```bash
# Terminal 1, from pidro_backend
PORT=4100 \
LIFECYCLE_TURN_TIMER_BID_MS=1200 LIFECYCLE_TURN_TIMER_PLAY_MS=900 \
LIFECYCLE_CONNECTION_CHECK_INTERVAL_MS=1000 LIFECYCLE_TURN_PAUSE_BUDGET_MS=1000 \
LIFECYCLE_BOT_DELAY_MS=60 LIFECYCLE_BOT_DELAY_VARIANCE_MS=40 \
LIFECYCLE_BOT_MIN_DELAY_MS=20 LIFECYCLE_TRICK_TRANSITION_DELAY_MS=80 \
LIFECYCLE_HAND_TRANSITION_DELAY_MS=120 LIFECYCLE_SECOND_DEAL_TRANSITION_DELAY_MS=120 \
LIFECYCLE_DEAL_TRANSITION_DELAY_MS=120 mix phx.server

# Terminal 2, from packages/mobile
EXPO_NO_DOTENV=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:4100 \
EXPO_PUBLIC_WS_URL=ws://127.0.0.1:4100/socket bun run web

# Terminal 3, from packages/mobile
API_BASE_URL=http://127.0.0.1:4100 WS_BASE_URL=ws://127.0.0.1:4100/socket \
node scripts/ci-game-e2e.mjs
```

Artifacts land in `screenshots/agent-game-e2e/` (override with
`E2E_ARTIFACT_DIR`). Expect roughly 35s for the solo game and 2–3 minutes for
the multiplayer UI game at CI pacing.

## Account journeys (the "Account e2e" CI job)

`e2e/` holds the account journeys (age gate, welcome and Home, guest, create account,
sign in, forgot password, saving a guest, claiming a Classic account, invites, dropped
connections) on `@playwright/test`. They drive the real Expo web client against a real
local backend, and each leaves a video; a failing one also leaves a trace. The `phone`
project (390×844) runs all of them; `landscape` (844×390) and `tablet` (820×1180) run
the ones tagged `@responsive` in their title. A journey tagged `@gap` asserts what the
app does today where a product fix is still open; the spec names the ticket.

What the suite starts or needs besides Expo web and the backend:

- A stand-in for Classic on `127.0.0.1:4001`, where the dev backend already looks for it
  (empty secret). The login says what Classic answers: `classic-…` exists, `off-…` is
  switched off, `rude-…` has a name that cannot be shown, `nameless-…` has no username,
  `oldtotal-…`, `counter-…` and `lower-…` differ in the games they played. The suite
  starts it itself.
- A stand-in for Apple's key server and for Facebook on `127.0.0.1:4002`. It makes an RSA
  key at startup and signs the Apple identity tokens and Facebook Limited Login tokens the
  journeys ask for; it answers the Graph calls for a classic Facebook access token. The
  backend is started with `APPLE_JWKS_URL`, `APPLE_AUDIENCE`, `FACEBOOK_JWKS_URL`,
  `FACEBOOK_GRAPH_URL` and `FACEBOOK_APP_ID` pointing at it (`e2e/ci.sh` has the values) and
  verifies every token as in production. Expo web must be started with `EXPO_PUBLIC_E2E=1`:
  only then do the Apple and Facebook buttons appear on web, taking their answer from the
  journey instead of the native sheet (`src/features/auth/e2eProviders.ts`). The seam lives
  only in a development bundle (`__DEV__`), and CI fails if a production export holds
  `__pidroE2E`.
- One reserved Classic name, `ReservedRita`, for the journeys where a name belongs to a
  Classic player. Load it into the database once, before the backend starts (insert only,
  so running it again is harmless): from `pidro_backend`,
  `mix pidro.import_classic_name_reservations <path to packages/mobile/e2e/classic-name-reservations.json>`.
- The old web client on `127.0.0.1:5173`, because the reset email links to it and the
  journeys follow that link.
- The backend with game pacing, so a bot game is over in under a minute: the journeys that
  need a finished game play it out with `scripts/autoplay-full-game.mjs --token`.

Journeys tagged `@second-run` need a backend with lifetimes of a second
(`CLASSIC_CLAIM_TICKET_TTL_SECONDS=1`, `PASSWORD_RESET_TTL_SECONDS=1`). Both runs use
`PASSWORD_RESET_DEBUG_TOKENS=false`. `e2e/ci.sh` runs the suite twice, restarting the backend
in between; `bun run e2e:accounts:second-run` is the second run. The weekly workflow runs the
same script against `main` and keeps its artifact for 90 days.

To run it on spare ports without touching your daily backend:

```bash
# Terminal 1, from pidro_backend (load the reserved name first, see above)
PORT=4100 PASSWORD_RESET_DEBUG_TOKENS=false \
LIFECYCLE_TURN_TIMER_BID_MS=1200 LIFECYCLE_TURN_TIMER_PLAY_MS=900 \
LIFECYCLE_CONNECTION_CHECK_INTERVAL_MS=1000 LIFECYCLE_TURN_PAUSE_BUDGET_MS=1000 \
LIFECYCLE_BOT_DELAY_MS=60 LIFECYCLE_BOT_DELAY_VARIANCE_MS=40 \
LIFECYCLE_BOT_MIN_DELAY_MS=20 LIFECYCLE_TRICK_TRANSITION_DELAY_MS=80 \
LIFECYCLE_HAND_TRANSITION_DELAY_MS=120 LIFECYCLE_SECOND_DEAL_TRANSITION_DELAY_MS=120 \
LIFECYCLE_DEAL_TRANSITION_DELAY_MS=120 mix phx.server

# Terminal 2, from packages/mobile
EXPO_NO_DOTENV=1 EXPO_PUBLIC_E2E=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:4100 \
EXPO_PUBLIC_WS_URL=ws://127.0.0.1:4100/socket \
NODE_OPTIONS="--max-old-space-size=8192 --require ./scripts/tailwind-v3-resolve.cjs" \
../../node_modules/.bin/expo start --web --port 8089

# Terminal 3, from packages/web (the port must be 5173: it is in the email link)
VITE_API_URL=http://127.0.0.1:4100 VITE_WS_URL=ws://127.0.0.1:4100/socket \
  bun run dev --host 127.0.0.1 --port 5173

# Terminal 4, from packages/mobile
API_BASE_URL=http://127.0.0.1:4100 MOBILE_BASE_URL=http://localhost:8089 \
  bun run e2e:accounts [part of a spec name]
```

Videos and traces land in `e2e/results/`, the HTML report in `e2e/report/`
(`bunx playwright show-report e2e/report`). Every test makes its own email, name,
install id and Classic login, so tests run in parallel and a rerun needs no reset.

## Deferred invite first-install proof

Test generated native projects in a disposable worktree; `ios/` and `android/`
are intentionally not committed. Use the development app variant so the test
cannot replace a store build:

```bash
bun install --frozen-lockfile
cd packages/mobile
APP_VARIANT=development bunx expo prebuild --clean --platform android
(cd android && ./gradlew :app:assembleDebug)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk

APP_VARIANT=development bunx expo prebuild --clean --platform ios
xcodebuild -workspace ios/Pidro3Dev.xcworkspace -scheme Pidro3Dev \
  -configuration Debug -sdk iphonesimulator build
```

A fresh Android sideload should have no Play referrer. It must still reach the
normal login screen without a native-module error, and subsequent launches
must not repeat the resolver. The debug app's AsyncStorage database should
contain both `deferred-install-attempted:v1` and one stable `install-id:v1` UUID.
Also exercise **Have a code?** with the keyboard open in portrait and landscape.

The deterministic Android path requires an authenticated Google Play internal
test track. Open an invite's generated Play URL, verify its `referrer` contains
exactly `invite=<code>`, install that track build, and confirm first launch opens
the existing invite preview. A sideload cannot prove Install Referrer delivery.

For iOS, uninstall the development build from a simulator or device, tap the
matching App Store button from a fresh invite, reinstall, and open the app
within 30 minutes on the same network. Confirm either the existing invite
preview or the safe normal-login fallback, then confirm no second resolution
attempt occurs. A physical App Store/TestFlight reinstall is the meaningful
coarse-match proof; a simulator can verify native linkage and the no-match path
but cannot reproduce App Store installation matching.

Record the device/runtime, store track or sideload method, whether a referrer
was available, and which path won. Never enable production matching until the
privacy addendum is live and Phoenix is running as the documented single app
replica.
