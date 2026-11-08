# Testing and proof contract

Marcel's non-negotiable requirement:

> I always want the expectations to be that the orb needs to provide irrefutable
> proof that whatever it has built is working.

**Prove the changed behavior, not merely green tests. Reduce redundant testing, not
confidence.** This policy applies to every feature thread and supersedes older
full-suite/pre-push matrix instructions. The backend has the same contract in its
`docs/testing.md` and root/engine/server agent guidance.

## Feature work in orbs: the budget and the obligation

- One ticket per thread; never reuse an old thread for a new task. Implement and
  prove the ticket, get one independent review, address its findings and rerun affected
  proof, not repeated review-and-fix rounds. After about 90 minutes, stop and report
  oversized scope, flaky checks or dependencies, with evidence and a proposed next step.
- Start the local backend/DB only when the change touches the app–backend contract.
  Client-only work uses focused fixtures/logic checks with their limitations disclosed;
  docs/CI work exercises the changed tooling without booting the product stack.
- Run the changed behavior itself, plus a nearby unchanged control and the relevant
  error/recovery case. Use the strongest reachable boundary, not a mock of the bug.
- Run **only affected tests**, not root `bun run test:unit`, a complete screenshot
  matrix, full gameplay/account journeys, native builds or native regression.
  Shared-code risk calls for representative consumers and their affected checks,
  not automatic escalation to every screen, device or journey.
- Start at **one standard phone size** (normally 390×844). Add **one** other size
  only for a named layout risk (e.g. landscape clearance, small-phone wrapping or
  tablet-specific allocation). Choose that risk's size, not all three. Keep affected
  default/open/loading/error states and a control; do not multiply the whole app.
- Full visual matrices, complete gameplay/account regression and native checks are
  **release work**, run on Marcel's machine or deliberately before a release. List
  them in the handoff; do not run them routinely in feature orbs. An optional nightly
  on GitHub runners needs a cheap, justified scope; none is configured or added here.
- Do not foreground-wait on long CI: no `gh run watch`, polling loops or sleeping
  until green. Report the commit, run URL and current state. A pending run is pending,
  not green or deployed. **Once pushed, finish the turn** with that pending/result handoff.
  Do not create schedules/subscriptions without authorization. Fix a reported failure
  caused by the change; don't silently waive it.

## Choose evidence before editing

Name the changed contract/entry point, likely wrong implementation, selected tests,
platform/width and expected observation. For a bug, reproduce it unchanged, then
rerun the **same inputs and timing** after the fix; a non-reproducing before run is
not regression proof. For a feature, capture the starting state and exercise the
new path. Extend existing public-boundary tests; preserve critical assertions.

For CI/tooling, execute the real CLI with valid and deliberately failing/missing
inputs. Show that rejection gates reject a planted failure. YAML parsing alone is
not proof. For guidance, audit realistic positive/negative scenarios. A document
audit is not a measured agent-compliance improvement; disclose if fresh-agent
old/new evaluations were not run.

## Risk → focused feature proof → release coverage

| Risk | Feature-orb evidence (affected checks only) | Deferred release evidence / trigger |
| --- | --- | --- |
| Docs, agent policy, selector/gate | Commands/links; real selection CLI; accepted and rejected gate inputs; policy scenarios. No app screenshots for tooling-only changes. | Full-run inventory/gate retained; execute complete regression deliberately for a release. |
| Logic, payloads, state, shared types | Affected Bun files with asymmetric/boundary/error inputs; exercise changed contract and representative consumers. Build/type/lint relevant packages as needed (static checks are not a full test suite). | Complete unit suite; integration consumers not exercised locally. |
| Screen copy/appearance | Inspect affected states plus a control at one phone size; DOM/geometry facts with screenshots. | All sizes/locales/text scaling in the visual matrix. |
| Wrapping, scrolling, absolute geometry, shared tokens/primitives/navigation | One phone plus one risk-selected size; representative consumers/gallery. Record interaction/motion when changed. Independent review still applies to load-bearing code. | Entire consumer matrix; native insets/font/gesture/presentation differences. |
| API/channel/auth/session/claims/join/reconnect/progression | Focused real-stack UI/API/channel scenario and denied/error/retry/reload control; logs/events and visible/state outcome. Fixtures alone cannot prove event ordering. | Full game and account journeys, persistence and expiry coverage. |
| Timing/race/animation | Force the bad delay/order; old failure/new success with exact position/opacity/state/event assertions, reset/control and focused repetitions if nondeterministic. | Broader lifecycle/game regression where relevant; not 20 full games to reproduce one delay. |
| Native keyboard/modal, safe areas, rotation, touch/VoiceOver, AppState, storage/SDKs, GPU/worklets | Strongest focused browser/logic proof available; explicitly name the native boundary **not verified**. Do not substitute a larger web matrix. | Affected iOS simulator/device path on Marcel's machine or deliberate release runner; real insets/input/settings/build identity. Hardware/provider/performance risks require the appropriate device/build. |
| Native dependency/config/entitlement/runtime/OTA | Focused configuration/compatibility checks; disclose unbuilt/uninstalled native binary. | Build/install/launch intended variant and capability; device smoke; compatible store build when runtime changes. OTA eligibility is not native runtime proof. |

### Browser is not native

Expo-web Chromium (including account Playwright and browser Game e2e) proves browser
behavior only. Phone/tablet/Android names and `safeArea=island` are synthetic.
They do not certify iOS insets, keyboard, native touch/scroll, VoiceOver, permissions,
GPU performance, lifecycle or native SDKs. Protocol gameplay proves protocol/server
integration, not touch UI. Label fixture injection, routed APIs and provider stand-ins.

Release tooling: [device flows](../packages/mobile/docs/DEVICE-FLOWS.md),
[fixtures](../packages/mobile/docs/FIXTURE-ROUTES.md),
[web/native parity](../packages/mobile/docs/WEB-PARITY.md). Record device/OS, build,
orientation, text/accessibility settings and candidate SHA. Expo Go fixture success
does not certify the store binary. Never install an emulator in a Linux orb.

## Stable proof, not repeated work

1. Finish edits/review fixes, formatting, installs and rebases **before** a visual
   pass. Freeze the served tree throughout capture. No edits, checkout, cherry-pick,
   Metro cache clear/restart or branch switching under an active test. Coordinate
   other editors; concurrent work needs a separate frozen worktree and server/port.
2. Confirm process/port, route readiness, backend identity and fresh bundle. Warm the
   route; record commit + dirty-patch identity, command and environment. Use supervised
   orb services, not detached shell servers.
3. Retain exit status (`set -o pipefail` with `tee`). Stale bundle, destroyed context,
   restart, timeout or incomplete captures invalidate the run. Diagnose, freeze, then
   rerun only the invalid/affected selection. Do not assert OOM/reload without evidence.
4. After the final edit, rerun affected checks/evidence if its dependencies changed.
   Reuse valid evidence for unchanged code. There is **no full local pre-handoff suite**.

Examples from `packages/mobile` against an already running test stack:

```bash
# Inspect the selection, then run only it. Landscape is justified by cut clearance.
UI_CASES=table-status-a,table-status-a-cut UI_VIEWPORTS=portrait,landscape bun run test:ui --list
UI_CASES=table-status-a,table-status-a-cut UI_VIEWPORTS=portrait,landscape \
  MOBILE_BASE_URL=http://localhost:8081 UI_SHOT_DIR=/tmp/status-shots bun run test:ui

# Focused readiness regression; real Chromium, synthetic table, no full game.
node --test scripts/readiness-e2e.test.mjs

# Affected unit file (from the root: bun test packages/mobile/test/game/layDown.test.mjs).
bun test test/game/layDown.test.mjs

# Focused real-stack account path, one project, no retry that hides a timing failure.
bun run e2e:accounts --project=phone specs/sign-in.spec.ts --retries=0

# Selection only; no browser and no full regression execution.
node scripts/ci-affected.mjs <base-sha> <head-sha>
```

Account checks need services/config from `e2e/ci.sh`; use isolated data, never
production writes. For timing bugs force the order; wait for the actual end state,
not blanket sleeps/larger timeouts/retries/weaker assertions. Report all failed
attempts and focused repetition counts; retry success does not erase a failure.

## Permanent CI split

`.github/workflows/frontend-ci.yml` has two modes:

- **Push/PR:** affected unit files (transitive local imports plus conservative area
  rules) and a tiny selector/gate smoke set. Visual changes select representative
  affected cases plus table/lobby/home/login smoke, capped at 16 cases and one phone
  viewport; layout changes add landscape (at most 32 case/viewport pairs; a case can
  capture additional interaction states at the same size). Docs/test-only edits
  need no app captures. Unknown paths or missing base use smoke, **never full fallback**.
  This is bounded regression coverage, not exhaustive impact analysis: the author
  must still prove the changed state, including new cases outside the sample.
- **Manual `full=true` (default):** complete unit suite, all UI cases/viewports and
  behavioral suites, full Game e2e, every Account journey and expiry check. Only this
  mode earns **Frontend ready (full)**, required on the exact candidate by `ship.mjs`
  for production. Manual full runs do not publish beta updates.

Push selection still compares against the last successful `main` push: cancellation
must not discard untested changes. Static build/type/lint/dependency checks and the
production export/test-seam check remain. Exact-once visual coverage uses the **same
case AND viewport filters** as captures; missing/duplicate captures still fail.
Pixel comparison/adoption is limited to captured screens; automatic adoption is
**not visual approval**. Other widths' baselines deliberately remain unchanged until
release: inspect/reconcile intended drift then, never bulk-accept unexplained drift.
Full release runs adopt nothing automatically. All critical grammar/behavior
assertions and callable Game/Account workflows remain available.

**Frontend ready** is the authoritative push aggregate. Its CLI rejects missing,
failed, cancelled or unexpectedly skipped selected jobs/invalid selection; an
unselected integration job may be skipped. Beta publishing still follows a successful
push workflow; this is **not** full-release or native certification. Native-risk
feature work may reach beta with native coverage explicitly deferred; the automatic
publisher does not wait for device QA. Store/native compatibility checks still apply.

Full account regression has manual dispatch, not a weekly schedule. Do not add
schedules/subscriptions or launch remote release/full runs without authorization.
On the backend, push CI likewise uses affected tests + smoke; a successful main push
auto-deploys the green SHA. Full Game/Account guards
remain callable release checks, not per-push deployment prerequisites. Manual/full
Backend CI does not deploy. Backup/migration/health/smoke/version checks remain.

## Release and handoff

Release owner: run a full green regression for the candidate deliberately, review
visual diffs/invalid/flaky runs, reconcile untested-size baselines, and collect the
native checks dictated by the risk table on Marcel's machine or an explicit release
runner. See [shipping](shipping.md) and [store builds](store-builds.md).

Feature handoff must name the claim, platform, command and decisive output, before →
after and control, inspected media/state facts, code/backend identity and limitations.
State local/committed/pushed/CI/deployed separately. **Missing required focused
evidence: “implemented; verification incomplete/blocked,” not complete.** Deliberately
deferred release coverage is a separate list with an owner; say “feature proof passed;
release/native verification pending,” never “native verified” or “release ready.”

The News/friends, leagues and Legend-chip threads motivated this split: repeated
Expo-web sweeps and interrupted Metro runs are leads, not measured attribution of
their 4h51m–7h50m elapsed times and not native iOS build evidence. Force the specific
race (e.g. delayed Home tick); assert the target exists before measuring it (Legend
chips), rather than repeating every journey or passing vacuous geometry checks.
