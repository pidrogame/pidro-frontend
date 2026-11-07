# Testing and proof contract

Marcel's requirement is non-negotiable:

> I always want the expectations to be that the orb needs to provide irrefutable
> proof that whatever it has built is working.

This means evidence of the **changed behavior**, not a synonym for green tests or
an assertion that nothing can ever fail. Each claim needs an observation that would
be different if the implementation were wrong. Match the claim to the platform and
boundary actually exercised. If required evidence cannot be obtained, hand back
**implemented; verification incomplete/blocked**, name the missing case and owner,
and do not claim complete, native-verified or ready to ship. Do not silently waive
requirements because the orb is Linux or CI is green.

## Choose evidence before editing

Record a short proof plan in the thread: changed contract and entry point, likely
regressions, checks selected and why, platform, and expected observations. Include:

- The reported data/state, a nearby unchanged control and relevant failure/recovery.
- For a bug, capture the failure on unchanged code and rerun the **same** scenario
  after the fix. A non-reproducing before run is not regression proof. For a new
  feature, capture the starting state and exercise the new user-facing path.
- For test/CI tooling, run the real command with passing and deliberately failing
  inputs. Plant a failure or revert the fix and show the test rejects it. Parsing
  YAML or reading code alone cannot prove gating behavior.
- For guidance, check realistic positive and negative scenarios against the rules.
  A document audit is not a measured agent-behavior improvement. Claim reliable
  compliance only after fresh-agent old/new evaluations; disclose when not run.

Prefer one discriminating regression at the public boundary over many private-helper
or mock-call tests. Preserve critical assertions. Extend existing suites first.

## Risk → required layer

Layers are cumulative where their risks apply, not a demand to run every layer on
every edit. Record why a layer is not applicable; don't silently omit it.

| Risk/change | During iteration and before handoff | Broader trigger |
| --- | --- | --- |
| Docs/copy-only instructions, CI selection/gates | Link/command checks; execute changed tooling with valid, missing and failing inputs. For visible copy, inspect the changed states and long/wrapping text. | Workflow/selector changes retain fail-safe full CI selection; native runs are not required for tooling-only changes. |
| Pure logic, state, formatting or API payload transformation | Affected Bun suite with asymmetric inputs, boundary and error/control cases. | Shared types, auth/session, persistence or multiple consumers: all relevant suites plus the integration paths below. |
| Screen-local appearance/copy | Named fixture cases: default + affected loading/empty/error/open states and one adjacent control; inspect screenshots and measured boxes/DOM. Start with one representative width. | Wrapping, viewport-dependent layout, absolute positioning, scrolling or clearance: narrow phone, landscape and tablet **affected cases**, plus large text/locales if at risk. Not the whole app matrix. |
| Tokens, primitives, navigation/shell, shared layout or renderer | Representative consumers and controls first; independent review per `AGENTS.md`. | Selected CI visual inventory (full for shared primitives/tokens), gallery and pixel diff; native representative consumers when insets, fonts, modal hosts, gestures, worklets or rendering differ. |
| API/channel/auth/session integration, joins, claims, reconnect, persistence, progression | Focused real-stack flow through the UI and real backend; record request/event + visible/state outcome. Include denial/error/retry/reload or reconnect where changed. | Changes affecting game completion, rematch, seats/readiness, scoring/progression delivery, shared socket/bootstrap or broad game state require the full relevant game/account journeys. Fixture injection cannot prove production event ordering. |
| Timing/race/animation | Force the bad delay/order. Capture old failure/new success, exact state/position/opacity or event order, and reset/error/control cases. Keep a regression that fails without the fix. | Repeated focused runs where nondeterminism remains; test reduced motion if animation changed. Broaden only for shared lifecycle/state/renderer risk, not because a timing test failed once. |
| Native modal/keyboard handoff, safe areas, rotation, gestures, VoiceOver/focus, AppState/backgrounding, secure storage, native auth/media/haptics, Skia GPU/worklets | Exercise the affected path on iOS simulator/device, with real insets and relevant input/accessibility settings. Show native screenshots/recording plus accessibility/state/log facts. | Device-required hardware, permissions, physical keyboard/IME, performance or provider behavior must run on a device/supported native build, not just Expo Go. Test both landscape directions/all edges when clearance changes. Repeat on Android only if claimed/supported by the changed path; otherwise disclose that gap. |
| Native dependencies, Expo/config plugins, entitlements, build/runtime/OTA changes | Native build/install/launch of the intended variant and affected capability, with build/runtime identity; verify OTA compatibility separately. | Release build/device smoke for startup, sign-in, join/play and changed native integrations. A web export or OTA eligibility result is not native build/runtime proof. |

### Browser is not native

`test:ui`, account Playwright projects (`phone`, `landscape`, `tablet`), and the UI
part of Game e2e run **Expo web in Chromium**. `safeArea=island`, Android-named
viewports and emulated keyboards are synthetic. They can establish browser geometry,
copy, hit testing and behavior, not iOS safe areas, native touch/scroll/keyboard,
VoiceOver, permissions, native presentation, real GPU performance or lifecycle.
Protocol gameplay proves protocol/server integration, not touch UI. Routed APIs,
fixture state and provider stand-ins must be labeled; they skip real boundaries.

Use [device flows](../packages/mobile/docs/DEVICE-FLOWS.md),
[fixture routes](../packages/mobile/docs/FIXTURE-ROUTES.md) and
[web/native parity](../packages/mobile/docs/WEB-PARITY.md). On a Mac with Metro
running and a booted simulator, from `packages/mobile`:

```bash
bash scripts/device-flow.sh seat-decisions
xcrun simctl io booted screenshot /tmp/seat-decisions-ios.png
```

Use the relevant flow/deep link, not this example for every feature. Record simulator
model, iOS version, orientation, font/accessibility settings, app variant/runtime and
commit. Expo Go fixture success does not certify the store binary. If no native
runner/device is available, ask for that evidence and leave native-risk work blocked;
do not substitute another browser matrix or install an emulator in a Linux orb.

## Cheap iteration, then a stable proof pass

1. Run affected tests/cases first. Fix the specific failure before expanding. Keep
   grammar/assertions with the screenshot; a capture without a state check can lie.
2. Finish edits/review fixes, formatting, installs and rebases **before** visual
   runs. Freeze the served tree for the entire run. Do not edit, checkout, cherry-pick,
   clear Metro or restart its service while it is being tested. Coordinate with any
   other editor. If editing must continue, use a separate frozen worktree (including
   the exact uncommitted patch) and its own Metro port, environment and output path.
   Never switch branches under a live capture server.
3. Check the intended port/process, route readiness, backend identity and bundle
   freshness before capturing. Warm the route. Record commit + dirty patch identity
   and command/environment. Run long-lived orb services under `amp orb service`, not
   detached shell processes. `CI=1` is CI configuration, not proof of a fresh bundle.
4. Keep output/exit status (`set -o pipefail` when piping to `tee`). Timeout, server
   restart, destroyed context, stale bundle or partial coverage is an **invalid or
   failed run**, not green. Inspect logs; do not assert OOM or edit-triggered reload
   without evidence. Freeze/fix the setup and rerun only invalid/affected selections.
5. After the final code change, run root `bun run shared:build && bun run test:unit`,
   and mobile `bunx tsc --noEmit && bun run lint` once. Repeat affected evidence if
   review/rebase changes its dependencies. An unchanged commit's valid evidence is
   reusable; don't redo full gameplay or the full screenshot matrix for a docs edit.

Examples from `packages/mobile`, with a running Expo-web service:

```bash
# First list exactly what the focused run would exercise (no browser required).
UI_CASES=table-status-a,table-status-a-cut UI_VIEWPORTS=portrait,landscape \
  bun run test:ui --list
UI_CASES=table-status-a,table-status-a-cut UI_VIEWPORTS=portrait,landscape \
  MOBILE_BASE_URL=http://localhost:8081 UI_SHOT_DIR=/tmp/status-shots bun run test:ui

# Focused readiness/order regression; real Chromium, synthetic table, no full game.
node --test scripts/readiness-e2e.test.mjs

# The Home-tick race: exact caption/arrow, opacity 1 and zero vertical offset.
UI_CASES=league-home-tick-up-en UI_VIEWPORTS=tablet-portrait \
  MOBILE_BASE_URL=http://localhost:8081 UI_SHOT_DIR=/tmp/tick-shots bun run test:ui

# Predict CI's regression selection; it does not inspect uncommitted edits.
node scripts/ci-affected.mjs <base-sha> <head-sha>
```

For timing regressions use an intentional delay/event ordering and preserve exact
assertions, not longer timeouts, blanket sleeps, extra retries or weaker expectations.
For a non-deterministic failure, state the focused repetition count and all failures;
a retry pass does not erase the failed first attempt. Existing account CI retries
remain diagnostic (warnings/traces are retained); they are not clean proof of a
timing fix. No default requirement for 20 full games or every viewport for a race.

For account iteration select a spec and project against the configured real stack:

```bash
bun run e2e:accounts --project=phone specs/sign-in.spec.ts --retries=0
```

This needs the backend, reset-link web client and provider stand-ins configured as
in `e2e/ci.sh`; it does not start services. Use isolated test accounts/data, not
production writes. Full gameplay remains separately runnable with a running backend,
database and Expo web via `node scripts/ci-game-e2e.mjs` (set `API_BASE_URL`,
`WS_BASE_URL`, `MOBILE_BASE_URL`, `BACKEND_DIR` and database environment as needed).
It includes protocol solo, real-browser multiplayer/rematch/rejoin/seat replacement,
talk and server-backed Legend chips; don't repeat it to verify unrelated copy.

## CI: one authority, full coverage available

`.github/workflows/frontend-ci.yml` is the regression authority. Preserve:

- **Select checks** measures pushes from the last successful `main` push, not simply
  the previous commit (a cancelled/red run must not lose coverage). Unknown paths,
  unreadable/no base, shared primitives/tokens, shared package, dependencies and CI
  changes run everything. Explicitly mapped changes run their area + smoke cases on
  every applicable baseline viewport and the affected integration suites. Do not
  narrow a rule without tracing consumers and testing its selection contract.
- **Mobile quality** always builds shared, runs Bun tests, type/lint/Expo dependency
  checks and a production web export; it rejects leaked `__pidroE2E` seams.
- **UI grammar** requires selected shards to pass, exact-once case inventory and
  existing captures, then baseline comparison. The table-behavior shard also runs
  the focused readiness regression. Pushes can auto-adopt drift only in their mapped
  area; that is **not human visual approval**. Inspect intended changes locally;
  shared/full runs cannot auto-adopt drift. Do not loosen assertions or bulk-accept
  unrelated baselines. See [fixture commands](../packages/mobile/docs/FIXTURE-ROUTES.md#scripted-checks-playwright-against-expo-web).
- **Game and account e2e** use one exact backend SHA per workflow; account aggregation
  requires every selected shard/expiry check. Docs-only runs need no backend lookup.
- **Frontend ready** / **Frontend ready (full)** is the aggregate, not any individual
  green job. `scripts/ci-ready.mjs` fails on missing/invalid selector outputs, missing,
  failed, cancelled or unexpectedly skipped dependencies. Full means every layer
  selected. Gate tests execute the same command with rejected and accepted inputs.
- The Beta update workflow consumes a **successful complete push workflow**; baseline
  adoption must also succeed. `ship.mjs` requires **Frontend ready (full)** on the
  exact pushed HEAD for production. Neither gate claims native proof. Required native
  evidence remains a pre-push obligation; it is not automatically collected/enforced
  by Linux Actions. Do not push native-risk work with that obligation outstanding.

Comprehensive regression: Actions → **Frontend CI → Run workflow**, `full=true`
(default). This retains all UI cases/viewports/suites, full Game e2e, every account
journey and expiry checks. It never publishes a beta update by itself. Preserve the
separate Game/Account callable workflows used by backend deployment. The existing
weekly account workflow is supplemental coverage, not the shipping gate; do not
add schedules/subscriptions or trigger a remote release/full run without authorization.

For a release: require a full green run for the candidate, review visual diffs and
flaky/invalid runs, and obtain the risk-triggered native build/device evidence above.
Native runtime/dependency/config changes need a new compatible store build, not an
OTA workaround. See [shipping](shipping.md) and [store builds](store-builds.md).

## Handoff evidence (in the thread)

Keep it short but concrete:

- **Claim / risk / platform:** what changed and which layer actually ran.
- **Before → after + control:** exact inputs, forced timing when relevant, observable
  state/API/log/geometry values and expected results. Link captured output, not a
  reconstructed transcript. Show a recording for interaction/motion and inspected
  screenshots for visible states; report DOM/accessibility facts alongside them.
- **Checks / identity:** commands with decisive output and exit codes, commit/patch,
  backend SHA, environment, device/build if applicable. Inspect media, don't just save it.
- **Limits / delivery:** mocked boundaries, untested platforms, failed/discarded runs,
  missing required evidence and who must supply it. State local/committed/pushed/CI/
  deployed separately. CI green does not mean native tested or deployed.

## Why this policy

The [News/friends](https://ampcode.com/threads/T-01a1a68a-ee84-74ae-a062-321da8a6d7ba),
[leagues](https://ampcode.com/threads/T-01a1a81c-ddd2-7098-aac2-48fea5e3322f) and
[Legend chips](https://ampcode.com/threads/T-01a1a576-8a2c-763b-872d-e3464e47d3cc)
threads show valuable geometry, real-backend and review coverage, but also repeated
broad passes, interrupted Metro runs and targeted timing failures. The Home-tick
failure was reproduced by delaying its callback, then fixed by waiting for the
actual animation end state. The Legend review caught assertions that passed because
no chips rendered: require the target to exist as well as checking its geometry.
These are actionable lessons, **not a measured attribution** of the reported
4h51m–7h50m elapsed times. None establishes native iOS build verification. Reduce
duplicate work and invalid runs, not the evidence standard or critical coverage.
