# Bringing the Expo web loop back up to speed

The current risk-based gate and proof requirements are in
[`docs/testing.md`](../../../docs/testing.md). This page records the parity findings
and available tooling, not a requirement to repeat a full device/browser sweep.

Measured 2026-09-20 on iPhone 17 Pro (iOS 26.2, Expo Go 56.0.4) against Expo web
at the committed baselines. Read with `FIXTURE-ROUTES.md`.

## What the measurement actually showed

**Rendering fidelity is not the problem.** `/ui-dev?state=components` and
`/table-dev?phase=bidding` render near-identically on web and native — same bevel
chrome, same Bree Serif gold, same Skia table geometry, same bid grid, same card
sprites, same wrapping. The `gradientBg()` web/native split and the CanvasKit
lazy-load are doing their job. Only the `ActivityIndicator` differs visibly
(CSS ring on web, spoke spinner on native).

**The loop was broken in three places that had nothing to do with rendering:**

| Breakage                                                                       | Effect                                                                                              | Status                                      |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `+native-intent.tsx` sent every non-invite deep link to `/+not-found`          | `just table-sim` and every `simctl openurl` fixture link 404'd — the entire simulator loop was dead | **fixed** (dev allowlist + tests)           |
| `ensure_expo_go` only installed when Expo Go was _absent_, never when outdated | a stale Expo Go (54.0.6) gave "Project is incompatible", which reads like a code error              | **fixed** (version compare)                 |
| `/table-dev` forced `{top:0,bottom:0}` insets on _every_ platform              | the simulator reproduced the browser's zero-inset blindness instead of correcting it                | **fixed** (real insets unless `?safeArea=`) |

That third one is the answer to "web diverged from mobile": the two didn't
diverge in output so much as the **loop lost its ability to see the difference
that matters**. The score plaque collides with the Dynamic Island on a real
device; web cannot show that, and the harness was hiding it on device too.

## The division of labour

Web is authoritative for the things it can actually prove, and for nothing else.

**Web proves (keep it as the fast gate):**

- Layout grammar, containment, wrapping, long-name behaviour
- Browser hit-box minimums (44 CSS px) — CI-enforced, not native reachability proof
- Token/primitive drift via pixel diff against `test/ui-baselines/`
- Browser flows that need clicking (Playwright); native interaction uses Maestro

**Known fixture-only difference:** an `data:image/svg+xml` URI renders in an
`Image` on web and silently falls back to the placeholder on native — so an SVG
data-URI avatar makes a fixture look right in a browser and wrong on a device.
Use a PNG data URI in fixtures. `table-dev`'s `fixtureAvatar()` still has this;
the gallery no longer does.

**Web cannot prove (device-only):**

- Safe-area clearance, notch/Dynamic Island, home indicator
- `usePillClearance` output — the derived clearance the constitution warns about
- Rotation and `useWindowDimensions` behaviour
- Gesture handling, Reanimated worklets, real scroll physics
- Skia performance and memory on a real GPU
- Font metrics and Dynamic Type scaling

## Plan

### 1. Make device truth cheap (done this pass)

Fixture deep links work again; `table-matrix.sh rotate [left|right] [phase]`
rotates and remounts so layout follows. One command to a real state on a real
device is the whole game.

### 2. Close the input asymmetry (done: Maestro)

Playwright clicks the web build; Maestro taps the simulator. Flows live in
`test/flows/` and run through `scripts/device-flow.sh` or the Maestro MCP server;
`docs/DEVICE-FLOWS.md` is the guide. This is what lets the _device_ loop verify
interaction, not just appearance, and lets an agent iterate on iOS UI instead of
screenshot-and-guess.

### 3. Add a device gate beside the web gate

`bun run test:ui` stays the fast pre-filter. Add a narrow device pass that
captures the safe-area-sensitive cases on one booted sim and diffs them against
their own baselines — separate directory, because device and web baselines are
different artifacts and should never be compared to each other:

```
test/ui-baselines/device/{portrait,landscape}/…
```

Candidate cases (the ones where insets decide the layout): `table-playing`,
`table-waiting`, `home`, `table-game-over`, plus each in landscape.

### 4. Stop `?safeArea=` from being the only inset story

The presets (`island`, `android`, `android-gesture`) exist so a browser can
approximate a device. Keep them for the web sweep. On device they are now an
override, not a default — so `verify-waiting-seats.mjs`'s six viewports stay
meaningful on web while the simulator shows the real thing.

### 5. Android, cheaply

On a supported Android host/device, use the same Metro session. The committed
baselines are Chromium, not Android coverage. Run affected native-risk cases,
not a full sweep for every change; the `android`/`android-gesture` browser inset
presets approximate two nav modes but cannot certify either on a device.

## What is explicitly not worth doing

- Chasing pixel-identical web↔native output. They will never match (font
  rasterisation, `ActivityIndicator`, shadow compositing) and the attempt would
  make the fast gate noisy and ignored.
- Treating `packages/web` (the Vite client) as a visual reference. It isn't one,
  and `AGENTS.md` already says so.
