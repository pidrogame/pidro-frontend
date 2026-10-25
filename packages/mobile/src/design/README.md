# Pidro Design System v2 — the constitution

Locked 2026-09-09. Everything user-facing is built from these tokens and primitives.
This document is the law; the canvas is the studio; `/ui-dev` is the enforced gallery.

## The material world

Pidro's UI is a physical place: a felt table with wood-and-gold furniture and glass
panels. Two rules follow from that and settle most decisions:

- **Buttons sit proud of the surface** — the four-layer bevel (below).
- **Inputs are carved into it** — dark-to-light wells with an inner top shadow and a
  bottom hairline glint (`Input`). Never restyle one into the other.

## The four-layer bevel

Every beveled control is the same sandwich, implemented once in
`src/components/ui/Bevel.tsx` and consumed via `BevelButton`:

1. **Rim** — gold (or glass) gradient, light falls from above.
2. **Keyline** — near-black seam (`#2A1505`, wood only) that makes the rim read as metal.
3. **Face** — material gradient + 1px top glint + bottom lip (inset `boxShadow`).
   The lip is the thickness.
4. **Gloss** — curved lens on the top 46%, never a flat band.

Materials: `wood` (primary/CTA, caramel ramp `#B57A31 → #91541C → #6C370E → #4E2509`,
Bree Serif gold `#FFD447` labels) and `glass` (secondary, translucent blues, Nunito 800
white labels). All values live in `PidroBevel` in `tokens.ts` — never inline them.

### Weights: lite and hero

- **`lite`** (default): 2px rim, 1px keyline, soft shadow — everyday controls.
- **`hero`**: 2.5px rim, 1.5px keyline, 6px lip, stronger gloss and shadow —
  **exactly one hero per screen** (PLAY on home). Juice is reserved, never sprinkled.

### Non-negotiables

- **Press physics**: the control travels 2px down, shadows tighten, lip compresses —
  90ms ease-out. No scale, no opacity flicker. (Built into `BevelPressable`.)
- **Optical lift**: labels ride 1px high (`translateY(-1)`) or their drop shadow makes
  them read low. Bree Serif needs ~1.3× line-height or descenders clip.
- **A CTA is an object, not a bar**: `fullWidth` caps at 380px and centers.
- **Touch targets ≥ 44px** (CI-enforced).
- **Proximity rhythm**: a form label sits 6px above its own field; blocks are 16px apart.
- On height-starved layouts (phone landscape, <500px tall) **decoration yields, not the
  form** — hide the logo, keep the fields comfortable.
- **Clearances are derived, never hardcoded.** A floating element (the tab pill) owns a
  hook that computes the space screens must leave from safe-area insets + its own
  geometry (`usePillClearance`, which also covers the floating update notice while it
  shows; a screen with no free bottom edge places the notice in its own free spot with
  `UpdateNoticeSlot`). Web previews have zero insets — a clearance tuned
  there WILL overlap on device.
- **Layered centering.** HUD chips (identity, rating) float as overlays; the world
  (logo) centers against the full height; an action stack centers within the zone
  below the HUD. Never let a corner HUD reserve a full-width row that sags the world.
- **Hero-ness lives in the chrome, not the bulk.** `weight` and `size` decouple:
  landscape keeps the hero material (thick rim, 6px lip, strong gloss) at lg
  proportions. Badges anchor to the capped control itself, never a wider wrapper.

## Safe areas belong to each native presentation root

- Keep the app-root `SafeAreaProvider`, and add a fresh `SafeAreaProvider` **inside
  each native `Modal`**, above its safe-area consumers. React context crossing a
  portal does not make the app provider a native ancestor of modal content.
- Let that provider measure the OS insets. Do not seed a remounting modal with
  `initialWindowMetrics`, cache inset values, detect phone models, or add fixed
  notch/status-bar padding. Left and right can differ and swap after rotation.
- Use `react-native-safe-area-context`'s native `SafeAreaView`, not React Native's
  deprecated one. `ScreenShell` applies all four edges once. Keep backgrounds
  full-bleed, but headers, touch targets and bottom actions inside the safe area.
  Do not add a second inset to content already protected by the shell.
- Keep the provider outside scrolling/animated content. Keep forms scrollable and
  handle the keyboard separately; a safe bottom inset is not keyboard avoidance.
- Verify portrait, both landscape directions, an older non-notched iPhone,
  Android gesture/button navigation, keyboard entry, and reopening after rotation.
  Synthetic browser insets test containment, **not native provider measurement**.
  Native release checks must use real device insets, never fixture overrides.

Sources: [provider placement](https://appandflow.github.io/react-native-safe-area-context/api/safe-area-provider/)
and [native SafeAreaView / initial metrics guidance](https://appandflow.github.io/react-native-safe-area-context/optimizations/).

## Account screens share one scaffold

Sign in, create account and Classic recovery are built on `AuthFlow`
(`src/components/auth/AuthFlow.tsx`). It owns the three layouts so no screen
branches on window size for structure:

- **Phone portrait**: round glass back button and a centred title, then a Bree
  Serif heading, one or two lines of body, the navy window, and quiet ways out.
- **Phone landscape** (under 500px tall): the heading and body move into a side
  column beside the window, with the flow's name as an eyebrow. Decoration
  yields; the form keeps its height.
- **Tablet**: a 436px column (380 inside the window, so fields and the capped CTA
  share an edge), larger type, centred and then lifted a little above the middle.

One wood `AuthFlowButton` per window moves the flow forward; glass is the second
choice; `TextLink` is the way out. `hero` is reserved for the button that
finishes a flow (CONTINUE on Pick your name). Classic claim and recovery always use
the default wood size, last in the window, never `hero`. Their glass choices appear
only on the method step, without a wood action; back, help and resend are links.
Errors that belong to a field sit
under it; anything else is an `AuthFlowNotice` at the top of the window.
Preview every state from `docs/FIXTURE-ROUTES.md`.

## Binary settings use inset glass switches

Use `PidroSwitch` for immediate on/off preferences, not a native `Switch` or a
wood action button. The navy track is a carved-in well; the pale glass thumb sits
above it. On moves the thumb right and lights the track with restrained cyan;
Off moves it left. The visible On/Off label means color is never the only cue.
Geometry, gradients and shadows live in `PidroSwitchTokens`.

The hit area surrounds the compact track and state label and is at least 44px;
never stretch the track to make a larger touch target. Tap toggles the controlled
value immediately. Only the thumb translates (140ms, honoring Reduce Motion),
with no drag gesture, bounce, scaling or button press travel. Expose one labelled
`switch` with checked/disabled state, keyboard operation and a visible focus ring.
Disabled switches retain their state and cannot be changed.

The `/ui-dev?state=components` switch sheet includes interactive on/off examples
and disabled on/off examples. Focus the interactive examples to inspect the ring.

## Team matchups

Group the host and partner together, opposite the two opponents. On Tables the
`vs` stays quiet: `PidroText` metadata, muted tone, no badge or ornamental plaque.
New table uses `TeamSection` and `VsDivider` (`components/lobby/SeatRow.tsx`): a
gold Bree Serif `vs`, on a fading gold line when stacked on a phone, the word
alone between columns and on iPad. The groups are `Us` (gold) and
`Them`, and each seat is one `SeatRow`, whose words come from
`features/lobby/seatRow.ts` (sheet: `/ui-dev?state=seat-rows`).
Table names are generated at creation, not an extra form step.

## Friends

A person with a status line is one `FriendRow` (`components/friends/`): on
Friends, Add a friend, the empty state, the seat picker and Blocked players. Its look and line come
from `friendRowState` in `features/friends`, and every "yesterday" or "in
September" from `relativeDay`, so screens never word a status themselves. A quiet
card among the rows is an `InfoCard`; a friend notice is a `NoticeCard`, which
enters and leaves like the update notice. Sheet: `/ui-dev?state=components`.

## Motion

- **Press physics** (built into `BevelPressable`/`PressableFX`): 2px travel or 0.97
  scale, 90–140ms ease-out. Never both; never opacity flicker.
- **Tab switches**: 140ms opacity-only cross-fade on the content (`(shell)/_layout`);
  the pill never animates during navigation. Route pushes (lobby, game) stay instant —
  `animation: 'none'` for game feel.
- **Ambient motion** is rare and slow (the 80s logo glow). One orchestrated moment
  beats scattered micro-wiggles.
- **Older devices**: animate only opacity and transform (GPU-composited); never
  layout properties. Every animation honors Reduce Motion
  (`useReducedMotion` / `ReduceMotion.System`) — the app must feel complete with all
  motion off.

## Type

- **Bree Serif** (`PidroFonts.display`): CTA labels, screen/plaque titles, big numbers.
  Weight 400 only; it brings its own character.
- **Nunito** (`PidroFonts.ui`): everything else, via `PidroText` roles
  (display/title/label/body/metadata, and `eyebrow` for a section's name above its
  rows). Never invent a size/weight outside the roles.

## Gradients and shadows (New Architecture)

- Gradients: `gradientBg(css)` from `Bevel.tsx` — `experimental_backgroundImage` on
  native, CSS `backgroundImage` on react-native-web. No image assets for chrome.
- Shadows: RN `boxShadow` strings, inset entries included. Skia is for the card table,
  `react-native-svg` for one-off vector chrome (banners, `LogoGlow`).

## Primitive selection

| Need                           | Use                                                                     |
| ------------------------------ | ----------------------------------------------------------------------- |
| Any action                     | `BevelButton` (wood = forward, glass = secondary, `icon` for square)    |
| Custom beveled control/surface | `BevelPressable` / `BevelSurface`                                       |
| Text                           | `PidroText` roles                                                       |
| Text entry                     | `Input` (label, error, `revealPassword`, full autofill markup)          |
| Binary preference              | `PidroSwitch` (inset track, glass thumb, explicit On/Off state)         |
| Panels, cards, plaques         | `Surface`                                                               |
| Screen scaffold                | `ScreenShell` (+ `ScreenHeader` for sub-screens)                        |
| Account-flow screen            | `AuthFlowScreen` + `AuthFlowWindow`, `AuthFlowButton`, `AuthFlowNotice` |
| Back out of a sub-screen       | `BackButton` (round glass, 44 on phones, 48 on tablets)                 |
| Quiet text action              | `TextLink` (cyan, 800, always a 44px target)                            |
| Row action, rules choice chip  | `ActionPill` (light cyan; `gold` answers someone; `selected` for chips) |
| Remove a row                   | `DismissButton` (borderless 44px ×; label names what it dismisses)      |
| A count on a tab or a title    | `CountBadge` (red; hides at 0, `99+` past 99)                           |
| Choice with confirm/cancel     | `DecisionWindow` / `Modal`                                              |
| Home navigation                | `HomeTabBar` (bottom bar portrait, right rail landscape)                |
| Player identity                | `PlayerAvatar` (ring, pin, level, turn light, dealer; sizes drop parts) |
| An earned number               | `RatingPlaque` (gold rim, carved face, Bree Serif figure)               |
| Progress toward something      | `LeagueProgress` (carved well + gold fill + quiet caption)              |
| Labelling the one hero CTA     | `CtaBadge` (wraps the control so the badge anchors to it)               |
| Any icon                       | `Icon` — never inline `<Svg><Path>` in a screen                         |
| Sign-in surfaces               | `AuthProviderButtons`, `AuthSheet`, `KeepProgressPrompt`                |
| Selectable custom control      | `PressableFX` (RN 0.85 drops style-function styles)                     |

Legacy: `Button` (old flat variants) is utility-only on unmigrated screens — no new
call sites. `MenuAction`, `PrimaryButton` are compatibility-only.

## The progression HUD

Home's corner HUD is its own small grammar, and it follows the material rule
rather than inventing a third treatment.

- **Identity is framed, numbers are mounted, progress is carved.** `PlayerAvatar`
  frames the photo in a ring — opaque glass for everyone, gold for a supporter —
  so the player is part of the furniture, not a photo pasted on top. It is the
  one way a player is drawn: Home, lobby, waiting table, game over, the table
  and the profile. Sheet: `/ui-dev?state=avatars`. `RatingPlaque` mounts an
  earned number like brass: gold rim, carved navy face, Bree Serif figure with
  the usual 1px optical lift. `LeagueProgress` is a **well** (dark, inset,
  hairline border), because progress is something the table records, not a
  control the player operates.
- **HUD objects are read-only.** A plaque or a ring never takes press physics.
  If it must be tappable — the identity block opens the profile — the _wrapper_
  is the `PressableFX`, and the HUD object inside stays inert.
- **One badge, on the hero.** `CtaBadge` wraps its control instead of sitting
  beside it, because a `fullWidth` `BevelButton` caps at 380 and centers; a
  badge anchored to a wider column drifts off the button it labels. Badges are
  decoration and are always `pointerEvents="none"`.
- **Progress values are clamped at the primitive.** `LeagueProgress` clamps to
  0–1 so a server that overshoots cannot overflow the track.
- **Accessibility labels are part of the primitive, not an afterthought.** They
  are how a device flow addresses a control (`docs/DEVICE-FLOWS.md`), so a
  primitive that renders a number or a state exposes it: `RatingPlaque` says
  `Rating 1487`, `LeagueProgress` reports its percentage. A control that only a
  human eye can find is not finished.
- **Icons are system objects.** Geometry lives once in `Icon` on a 24×24 grid;
  stroke glyphs keep a 2px stroke so they survive chip sizes. A new glyph is an
  edit to `Icon`, never an inline path in a screen.
- The sheet is `/ui-dev?state=progression`, screenshotted by CI like the rest.

The numbers behind these are mocked until leagues and levels land server-side.
That is deliberate: the _shape_ is settled, so real data drops in without
moving anything.

## How changes trickle down

1. **Explore** on the design canvas (Pidro Design System v2 artifact — System page has
   the sheets, Explorations page the screen work).
2. **Implement** by changing `tokens.ts` and/or the primitive — never a screen-local copy.
3. **Enforce**: `/ui-dev?state=components` renders the system; CI screenshots it and
   pixel-diffs against `test/ui-baselines/`. Intentional change ⇒ adopt the CI run's
   captures: `bun run ui:baselines <runId>`, review, commit.
4. **Consume**: screens use primitives and tokens only. A screen needing a new look is
   a request to extend the system, not permission to fork it.

## Known gaps (extend the system here next)

- Marquee banner (gold rim / wood band / navy panel plaque) — designed on the canvas,
  not yet a `react-native-svg` primitive.
- Danger material for `BevelButton` (designed on the canvas Buttons sheet).
- In-game windows (bid grid, hand selection) still on legacy surfaces. Trump is
  picked in the felt (`TrumpPicker`), not in a window.

## Exceptions

- The Skia card renderer owns card art, hit testing, and card motion.
- Fixed table plaques may cap font scaling to protect coordinate-bound layouts.
- Game-over celebration may go loud, but from shared tokens and primitives.
