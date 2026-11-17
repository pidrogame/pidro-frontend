# Device flows — driving the simulator

**Release tooling, not a feature-orb requirement.** Per
[`docs/testing.md`](../../../docs/testing.md), native checks run on Marcel's machine
or deliberately before release. Feature orbs prove changed behavior narrowly and
list native verification as pending; browser success never certifies native input.

Everything in `FIXTURE-ROUTES.md` gets you to a _state_. This gets you to an
_interaction_: tapping, typing and asserting on a real simulator, where safe
areas, touch targets and gestures are real. `WEB-PARITY.md` explains why the
browser tier cannot settle those.

Tooling is **Maestro** (mobile.dev). It drives the simulator with its own
XCUITest runner — no `idb`, no Appium server.

## Why Maestro and not idb

`idb` gives raw primitives (`tap x y`). Everything that makes a device loop
usable — find by label, wait for it to appear, retry when it doesn't — you
would build and debug yourself. Maestro ships that as the product, and its
selectors are accessibility labels, so flows survive layout changes.

It also needs no `brew trust` grant, and Java (its one dependency) is already
here.

## Install

**Not `brew install maestro`** — that name belongs to an unrelated product.

```bash
# Requires java (openjdk@17 is already installed here) and unzip.
curl -Ls https://get.maestro.mobile.dev | bash          # or, without piping to bash:
curl -fL -o /tmp/maestro.zip \
  https://github.com/mobile-dev-inc/Maestro/releases/latest/download/maestro.zip
unzip -qo /tmp/maestro.zip -d /tmp/mx && mkdir -p ~/.maestro && cp -rf /tmp/mx/maestro/* ~/.maestro/
```

It lives entirely in `~/.maestro`. Remove with `rm -rf ~/.maestro`.

This machine's copy is **not on PATH** (the installer's shell-rc edit was
skipped), so call it by path or export it per shell:

```bash
export PATH="$HOME/.maestro/bin:$PATH"
```

## Run a flow

```bash
cd pidro_frontend/packages/mobile
just mobile                                    # Metro must be running
maestro --udid <UDID> test test/flows/seat-decisions.yaml
maestro list-devices                           # find the UDID
maestro hierarchy                              # dump what Maestro can see
```

Flows live in `test/flows/`. Screenshots do **not** land in the repo — they go
to `~/.maestro/tests/<timestamp>/<flow>/takeScreenshot/…`, and the path in
`takeScreenshot:` is a subpath under that.

## Writing a flow: the four things that will bite you

1. **`appId` is Expo Go**, not Pidro: `host.exp.Exponent`. The app under test
   is whatever Metro is serving. (A dev-client build would use its own id.)

2. **Always `- stopApp` before `- openLink`.** Opening a deep link for the
   route the app is _already on_ does not remount it — expo-router keeps the
   mounted screen and its params. A rerun would silently inherit the previous
   run's state and assert against it. This is the same staleness that makes
   `?state=` changes appear to do nothing on a warm app.

3. **Use `extendedWaitUntil`, not `assertVisible`, for anything that arrives.**
   A cold Metro bundle takes ~30s, and overlays animate in. A bare
   `assertVisible` races both and fails intermittently — which reads like a
   real regression.

   ```yaml
   - extendedWaitUntil:
       visible: 'Review seats (3)'
       timeout: 45000
   ```

4. **Selectors are accessibility labels**, so they are a product concern.
   `accessibilityLabel` on a primitive is what makes it addressable — the
   progression HUD's `RatingPlaque` exposes `Rating 1487`, `LeagueProgress`
   exposes its percentage. Run `maestro hierarchy` to see exactly what a screen
   offers before guessing.

## For agents: the MCP server

`.mcp.json` at the monorepo root registers Maestro as a project-scoped MCP
server, so an agent gets simulator control as first-class tools rather than
shelling out:

| Tool              | Use                                                       |
| ----------------- | --------------------------------------------------------- |
| `list_devices`    | find the booted simulator                                 |
| `inspect_screen`  | the view hierarchy — **do this before writing selectors** |
| `run`             | run a flow or ad-hoc Maestro commands                     |
| `take_screenshot` | capture current state                                     |
| `cheat_sheet`     | Maestro's own command reference                           |

The `*_cloud_*` tools need a Maestro Cloud login and are not used here.

Working loop for an agent: `inspect_screen` to learn the real labels → write or
edit a flow in `test/flows/` → `run` it → `take_screenshot` to see the result.
Do not guess coordinates; tap by label.

## What belongs in a device flow

A device flow is expensive (a simulator, a Metro bundle, ~30s of startup).
Spend it only on what the browser tier genuinely cannot prove:

- Safe-area clearance and overlay collisions with the notch/home indicator
- Real touch targets and whether a control is actually reachable
- Gestures, scroll physics, rotation behaviour
- Anything where `usePillClearance` decides the layout

Grammar, wrapping and containment stay on `bun run test:ui` — it is seconds,
not minutes. See `WEB-PARITY.md` for the full division of labour.

`test/flows/seat-decisions.yaml` is the worked example: the device twin of
`scripts/verify-seat-decisions.mjs`, which can only ever run in a browser.

## A card pressed again while it is played (PID-444)

`scripts/press-during-play.native.mjs` proves that a card your finger touches
again before its play is drawn still lands on the table, rather than hanging
over the hand. The touch runs on the UI thread and the table redraws from the
JS thread, so neither the browser nor two Maestro taps can reach that order: the
script holds the app's JS thread busy through Metro's debugger, taps the card
and presses it again, and lets the play be drawn under the finger. It compares
that run with one plain tap, and reads the sprites from the table's dev hook
(`globalThis.__pidroCardMotion`), whose `pressed` flag shows the finger was
still down. It taps at the card's point from that hook, not by label: the card
has no label of its own.

```bash
just table-sim "iPhone 17 Pro" playing   # Metro running, one simulator booted
METRO_PORT=8081 node scripts/press-during-play.native.mjs
```

Exit 0: the card landed where one tap puts it. Exit 1: it hangs over the hand.
Exit 2: the control failed or the play was not drawn under the finger; the run
proves nothing, so rerun it or tune `HOLD_MS`/`PRESS_MS`. Release work, like
every flow here; run it with one Android phone check by hand.

## Android's Back at the table (PID-458)

A browser cannot press Android's Back, and the orb has no emulator, so this is
checked by hand on an Android phone at release, with the button and with the
back gesture. Each press must do exactly this:

- Mid-hand, nothing open: "Leave table?" opens. "Stay at table" or Back again
  closes it and you are still seated; "Leave table" takes you to the lobby (or
  Home for a solo game) and a bot takes the seat.
- Settings, a seat's sheet, the talk or the rules open: Back closes that only.
- Waiting table: with the talk's field focused (seats folded), Back unfolds the
  seats; the next Back asks "Leave table?".
- Game over: Back goes Home without asking.
- Watching a table: Back returns to the lobby without asking.
- Claim Classic opened from the game-over sheet: Back closes it, not the table.
