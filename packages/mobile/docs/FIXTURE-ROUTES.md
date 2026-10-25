# Pidro fixture routes — cheatsheet

Dev-only routes (`__DEV__` guarded; they redirect to `/home` in release). No login,
no backend, no playing a game to reach a state. Print and tape.

## Open one

```bash
# Simulator (Metro already running via `just ios` / `just mobile`)
xcrun simctl openurl booted "exp://127.0.0.1:8081/--/table-dev?phase=bidding"
just table-sim "iPhone 17 Pro" bidding     # boots one sim, shuts the others down

# Expo web
bun run web        # then http://localhost:8081/table-dev?phase=bidding
```

Deep-link form is `exp://127.0.0.1:$METRO_PORT/--/<route>?<params>`. Note the `/--/`.

---

## `/table-dev` — the table

### Bounded locale fixtures

Only `/ui-dev`, `/table-dev`, and `/auth-flow-dev` accept these development-only
overrides. Production builds redirect these routes; normal routes ignore locale
query parameters, including Settings.

| Parameter                 | Meaning                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `locale=en\|sv`           | Initial displayed copy, independent of the selected radio                                                          |
| `language=system\|en\|sv` | Initial selected language preference (ephemeral)                                                                   |
| `deviceLocale=sv-FI`      | Device-language input for System (also accepts `sv-SE`, `en-US`, etc.; unsupported languages fall back to English) |

For consistent System metadata, pair `locale=sv&language=system&deviceLocale=sv-FI`.
Explicit `locale` wins initially, allowing every selected option to be inspected
in either language. Selecting a radio immediately resumes normal resolution from
the ephemeral choice and simulated device locale. Neither mount nor selection
writes the real language preference. Foreground/settings notifications preserve
the focused fixture override; blur/unmount restores the persisted real preference
and actual device locale. The boundary has no locale key and never remounts a game.
Without params, copy starts from the real preference; fixture language selection
is still ephemeral.

Examples: `/ui-dev?state=settings&locale=sv&language=en&deviceLocale=sv-FI`,
`/table-dev?phase=declaring&locale=sv`, `/auth-flow-dev?locale=sv`.

The second deal loops at `/table-dev?deal=draw`, fed the snapshots the server
sends (trump named, then the hand ready to play, play held while the table
shows the second deal). It plays at Classic's pace: each player in turn from
the dealer's left throws their non-trumps face down in front of them, the
piles hold to be counted and clear, the dealer gives each player their cards
one at a time and takes the rest unseen. The dealer never shows a discard.
`you=deal` has you deal; `hand=still|tilt|fan` tries how hands hold their
cards. **Tune** opens live timings (each change replays); the link takes the
same keys, e.g. `&holdMs=3000&cardMs=230&throwGapMs=550`. The server's
`second_deal_transition_delay_ms` must hold play for the whole of it.

The end of a hand loops at `/table-dev?deal=hand`: the last trick, the
hand's result, and the next hand dealt once it closes (the server sends the
next hand with the one that ended; the table holds the ended hand meanwhile).
`end=they-made|we-made|we-missed|they-missed`; **Tune** changes how long the
result stays (`showMs=` in the link). The server's `hand_transition_delay_ms`
must cover the result and the deal.

PID-214 bid presentation uses `/table-dev?phase=bidding&role=player&bids=round|high&locale=sv`.
`table-bid-*` and `locale-sv-table-bid-*` check every seat's visible/spoken bid,
the high-bid tone and compact south status without changing bid event identities.

PID-277 uses `/table-dev?fixture=bot-crew&locale=en|sv`: Marcel is thinking,
and all three drawn bots open their short card through their avatar or nameplate.
It applies the server's seat lifecycle shape: bots have a persona but no account ID.
`table-bot-card-{marcel,antti,jocke}-{en,sv}` checks the copy, Close/reopen,
44pt targets and no scrolling. Game over against the crew shows no rematch row
(bots always agree, PID-292), so the card opens only at the table.
Cards stay closed until tapped. `table-bot-thinking[-antti|-jocke]-{en,sv}`
checks each voice's visible nameplate line and that reloading keeps it.
`botTurn=north|east|west&botHand=1|2|3|4` tries every line of the crew.
All run at 390×844, 375×667,
844×390 and 768×1024. Persona keys live beside `BotPersonaFace.tsx` in
`botPersonas.ts`; all editable English/Swedish persona copy is together in
`packages/shared/src/i18n/sections/bots.ts`. These describe the bots at play,
not the real people's biographies or a guarantee about their bidding strategy.

Friends locale previews use `/ui-dev?state=friends&fixture=added-you&locale=sv`
or `/ui-dev?state=friends-add&fixture=results&locale=sv`. They reuse the actual
screens and existing fixture data; `/friends` and `/friends-add` ignore locale
query parameters. `locale-sv-friends-*` checks list/empty/loading/error, add-back,
recent/search results, profile/removal and the guest-save gate alongside the
existing English Friends cases.

New table seats use `/ui-dev?state=new-table&fixture=picker|friends` for PID-244's
choice list and deeper friend picker. `/lobby?fixture=held` and
`/table-dev?phase=waiting-host&fixture=held` show server-held seats. Invitation rows
stack at `/home?fixture=invitations` (including the Friends count badge) and
`/lobby?fixture=invitations`. The old `table-invite` fixture now shows only the
table share link (Copy/Share), without a position or seat-preference form.

Grammar cases `locale-{en,sv}-settings-{system,en,sv}` and
`locale-{en,sv}-{waiting,bidding,trump,hand-selection,game-over,dealer,playing}`
run at 390×844, 844×390, 667×375, plus localization-only additions to the
360×640 and 768×1024 shards. They reuse containment and 44px target checks
(including radios), assert selection/System metadata and non-persisted interactive
switching, and reject clipped natural text without shrinking fonts. Long public
player names retain intentional ellipsis. Captures precede interactive switching.
No baseline refresh is implicit.

The bounded `iphone-insets-portrait` (402×874) and `iphone-insets-landscape`
(874×402) grammar cases cover the trump picker and Settings language group.
`safeArea=iphone-17-portrait` simulates 62/34 top/bottom, and
`safeArea=iphone-17-landscape` simulates 62pt on both sides and 21pt bottom.
Settings accepts these via `/ui-dev?state=settings`; table fixtures use `/table-dev`.
These are browser approximations only. Native review must omit `safeArea`.

```bash
NODE_OPTIONS=--max-old-space-size=4096 MOBILE_BASE_URL=http://localhost:8089 \
UI_CASES=locale-en-settings-system,locale-sv-settings-system,locale-sv-bidding \
UI_SHOT_DIR=/tmp/pidro-locales node scripts/verify-ui-grammar.mjs
```

### `phase=` (default `playing`)

| Value              | Shows                             | testID                  |
| ------------------ | --------------------------------- | ----------------------- |
| `waiting`          | Shared new-table team list, 3 seated + 1 free | `waiting-table` |
| `waiting-host`     | Host team list; tap a seat to invite or kick, no Manage/Lock panel | `waiting-table` |
| `ready`            | Full table, ready-up flow         | `waiting-table`         |
| `ready-host`       | Full team list; occupied rows open kick confirmation | `waiting-table` |
| `ready-solo`       | You + three ready bots            | `waiting-table`         |
| `dealer_selection` | Skia table, dealer cut cards      | `seat-north`            |
| `playing`          | Skia table + trick overlay        | `seat-north`            |
| `bidding`          | Bidding window                    | `bidding-window`        |
| `declaring`        | You dealt: trump picker in felt   | `trump-picker`          |
| `second_deal`      | Dealer's private hand selection   | `hand-selection-window` |
| `game_over`        | Game over: win reveal or loss     | `game-over-window`      |

### Params

| Param        | Values                                                                                    | Effect                                                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phase`      | see above                                                                                 | which overlay                                                                                                                                                             |
| `safeArea`   | `island` (59/34) · `android`/`android-buttons` (24/48) · `android-gesture` (24/24)        | **fakes insets** — the one way to test notch clearance on web                                                                                                             |
| `role`       | `player` · `spectator`                                                                    | non-waiting phases: renders via the **real store/controller**, not the mock model                                                                                         |
| `lifecycle`  | `normal` · `reconnecting` · `bot_substitute` · `permanent_bot` · `vacant`                 | seat lifecycle badge state                                                                                                                                                |
| `feedback`   | `owner` (3 queued seat decisions) · `notice` (tap closes it) · `timed` (dedupe + success at 0.8/1.0/1.2s) | TableFeedback / TableSeatDecision; a notice stays at least `readingTimeMs` of its words |
| `notice`     | `true`                                                                                    | same as `feedback=notice`; on a waiting phase, a join notice below the toolbar                                                                                            |
| `connection` | `lost`                                                                                    | with `role=`: the channel is down, so the table shows its Reconnecting… banner                                                                                            |
| `invite`     | `true`                                                                                    | opens InviteModal (needs `phase=waiting-host`/`ready-host`)                                                                                                               |
| `names`      | `long` · `max`                                                                            | waiting: west seat → "Alexandria the Long-Named Player" (wrapping); table: Classic-length names on every seat (ThunderThor88 …); `max`: that 32-character name on every table seat |
| `dealer`     | `north` · `east` · `south` · `west`                                                       | table (mock model): who holds the dealer chip, default `south`                                                                                                            |
| `timer`      | `running`                                                                                 | table (mock model): a 20 s turn timer on the seat on turn; amber in its last quarter                                                                                      |
| `signals`    | `pidro`, `pidro-theirs`, `points`, `points-theirs`                                        | mock table, `autoplay=true`: `pidro` gold "Pidro!", "Us +6"; `pidro-theirs` coral "Them +5 · Wynn"; `points(-theirs)` a gold (coral) "+1" and the 2 of trump's            |
| `hand`       | `made` · `set` · `they-set`                                                               | table (mock model): 1.6 s after the table opens the last hand is scored: the table dims under its result and the point cards each team took (PID-236). `made`: you made 8, stamped gold; `set`: you missed 10 by 3; `they-set`: Eli missed 9 by 3 and Nora took their Pidro. It closes by itself after 3 s (2 s for `set`) |
| `ticker`     | `full`                                                                                    | table (mock model): the table opens with West's pass, and the other three bids land 0.3 s later, so the plaque's action ticker shows three lines; tap it for the hand log |
| `bids`       | `round` · `high` (with `phase=bidding&role=player`)                                       | you and three bots; the bids land one by one. `round`: West passes, North bids 7, East goes to 9, then it is your turn. `high`: you hold the high bid at 9 and West is still to bid |
| `out`        | `one` · `lone` (with `phase=playing&role=player`)                                         | you and three bots, two tricks into hand 4 after Jocke bid 6. `one`: Marcel is out of trumps (dimmed, "Out", two cards folded face down). `lone`: the other three are out, and your seat says the rest is yours |
| `trick`      | `bots` (with `phase=playing&role=player`)                                                 | you and three bots, hearts trump: Wynn, Nora and Eli have played 9♥, K♥ and 4♥ to the first trick, and each seat says what it played; it is your turn |
| `count`      | `on`                                                                                      | turns on "Help me keep count": the plaque’s bid line reads "Jocke bid 6 · 2 of 6" (small phones too; a name with no room beside the bid takes a row of its own), "Last trick" sits under it, and the card winning the trick glows (mock table too) |
| `playerName` | any string                                                                                | name in the first seat decision                                                                                                                                           |
| `viewer`     | `east`                                                                                    | you are east instead of south                                                                                                                                             |
| `rematch`    | `open` · `one` · `two` · `asked` · `waiting` · `missing` · `pending` (with `phase=game_over`) | the rematch row, per seat: nobody asked / Nora has / Nora and Eli have / the other three wait on you / you asked first; `missing` has no vote yet, `pending` is sending yours |
| `pass`       | `disabled`                                                                                | removes the pass action from legal actions                                                                                                                                |
| `autoplay`   | `true`                                                                                    | Skia table auto-plays (trick completion / card persistence)                                                                                                               |

### Recipes

PID-268: `/table-dev?phase=playing&hand=own` holds the result without a timer;
a tap on the table, panel or **Tap to continue** releases this local fixture
(it does not send a channel intent). `hand=own-missed` shows a missed bid.
`menu=pace&solo=true` opens Pace for a bot table; omit `solo` for the human-table
Quick note. Add `locale=sv` for Swedish. Grammar cases `table-hand-own(-sv)`,
`table-pace-solo-en|sv`, `table-pace-human-en|sv` and `settings-pace-en|sv` cover
390×844, 375×667, 844×390 and 768×1024. The table windows fit without scrolling;
the existing full Settings page still scrolls to its account and update sections.

`/table-dev?fixture=details&bidder=east` (PID-272) shows a winning bid of 7,
count help off, six subtly offset backs at each opponent, and a spade hand with
5♣ directly after 5♠, then hearts/clubs/diamonds. `bidder=north|south|west`
checks the other seats and team tones. Add `phase=bidding|declaring|second_deal|game_over`
for the chip's lifecycle. The `table-details-*` grammar cases cover 390×844,
375×667, 844×390 and 768×1024, including the menu switch and fixed back poses.

Game-over checks: `phase=game_over` supports `result=loss|east|spectator|tie`,
`xp=earned|level`, `rematch=open|one|two|asked|waiting|missing|pending`, and
`playerName=` for the partner's long name. The default is a win (62–29) with no
XP. Every result but the tie carries a ten-hand `hand_history` and the final
`last_hand`: level at 41 after hand 8, and the losing side's best hand is hand 7
(won 12 of 14, both Pidros). `xp=` also sends the summary's `partner`, three
wins in a row on a win. Rematch records a local fixture vote; Home navigates
home. Run `node scripts/verify-game-over.mjs` for
phone/tablet, simulated insets, outcome, voting, and reduced-motion checks.
These browser checks do not certify native safe-area measurement.

PID-292 game over, the four screens to check:

| URL                                                                  | Shows                                                                                                                         |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/table-dev?phase=game_over&guest=true&crew=win`                     | A guest beat the bot crew: Marcel's JA36 game, 62–36 in 7 hands with Jocke, all 14 in hand 5. Winning trick, Every hand ›, Play real people |
| `/table-dev?phase=game_over&guest=true&crew=loss`                    | The same game lost (36–62): best hand, Every hand ›, Play real people                                                          |
| `/table-dev?phase=game_over&xp=earned&rematch=one`                   | An account won with people: race chart with Every hand › in its header, streak and XP chips, the rematch row                  |
| `/table-dev?phase=game_over&result=loss&xp=earned&rematch=waiting`   | An account lost with people and is waiting on a rematch                                                                        |

`crew=win|loss` seats Jocke (partner), Marcel and Antti as permanent bots. With
three bots there is no rematch row; a guest sees no race chart; no game over shows
the rule set. `table-game-over`, `table-game-over-guest-win`,
`table-game-over-guest-loss` and `table-game-over-people-loss` check that, that
the top-level blocks never overlap, and that nothing leaves the screen, at
390×844, 375×667, 844×390, 667×375, 834×1194 and 1194×834.

The table's header is one row: the score plaque left, the menu right
(`TABLE_HEADER` in `TableChrome.tsx`). Portrait reserves it above the north seat;
landscape seats North inside it. Notices and the Reconnecting… banner share one
slot (`useTableReserves().noticeSlot`): the dock under the hand in portrait, the
felt below the header in landscape, below the toolbar in the waiting room. The
grammar fails when the header, a notice or a protected window covers the north
seat or its cards.

Score checks (PID-275): `fixture=scores` rejoins the real store/controller with nine
completed hands; tap the score plaque for the server ledger, newest first.
`fixture=scores-game-over` shows the race chart, "How it went · 10 hands", with **Every hand ›** in its header.
`fixture=all-14|all-14-theirs` shows either team's six point cards and **All 14!**.
Add `hand=own` to either sweep for the combined all-14 + Continue gate; the
`scores-{en,sv}-all-14(-theirs)-own` cases also check that tapping the dimmed table continues
and that the entire panel clears synthetic Android 24/48 insets (`safeArea=android`).
Add `locale=sv` for Swedish. The `scores-{en,sv}-{table,game-over,chart,all-14,all-14-theirs}`
grammar cases check every page of the ledger and the result at 390×844, 375×667,
844×390 and 768×1024. Older/Newer pages keep the panel bounded without screen scrolling.
PID-291 uses JA36 hand 5 for both sweep fixtures: Jocke bid 10 in hearts,
14–0, A♥ 2♥ 10♥ J♥ 5♦ 5♥. The opposing fixture swaps the teams; running totals
are illustrative. Only our sweep gets rays, one confetti burst and a larger stamp.
`viewer=spectator` on the sweep keeps the headline but removes the celebration.
The five result states are `hand=own`, `hand=own-missed`, `fixture=all-14&hand=own`,
`fixture=all-14`, and `fixture=all-14-theirs` on `/table-dev?phase=playing`.
Grammar cases `table-hand-own(-sv)`, `table-hand-own-missed-{en,sv}` and the
`scores-{en,sv}-all-14(-theirs)(-own)` cases cover all four sizes above, no wood
button, a labelled cyan link only at own pace, and continuation from the scrim.
`hand=own&reply=continue` (`table-hand-own-retry`) rejects the first attempt,
then acknowledges the retry before a delayed state update. It displays an attempt
count so the grammar can check rapid taps, failure/retry and the acknowledgement gap.
`table-hand-sweep-spectator` is the no-celebration control. Still captures show
static rays and no confetti; omit `__pidroStill` to see the burst and six-second
Quick timeout. Quick timing remains server-bound; this fixture does not simulate
the server's next-hand timers. Browser checks cannot verify native haptic delivery.
`/table-dev?deal=hand&end=game-over` completes an all-14 hand through the real
store/controller. `verify-game-over.mjs` checks that only game-over celebrates,
with no hidden hand-result panel, both with and without reduced motion.
`scores=history` also seeds nine hands in the mock table.
`safeArea=island-left` / `island-right` simulate landscape side cutouts.
Run `MOBILE_BASE_URL=http://localhost:8081 node scripts/verify-table-chrome.mjs` for
five-size score/history/settings checks. Sound is marked Coming soon; the haptics switch
controls the native gameplay feedback.

For waiting-screen failure feedback, append `readyResult=error` to a ready fixture.
The normal ready fixtures delay confirmation briefly to expose the pending state.

```
/table-dev?phase=bidding
/table-dev?phase=playing&safeArea=island          # notch clearance
/table-dev?phase=waiting-host&invite=true         # invite modal
/table-dev?lifecycle=permanent_bot&feedback=owner&notice=true    # decision + notice together
/table-dev?phase=waiting&names=long               # long-name wrapping
/table-dev?phase=bidding&role=player&pass=disabled   # real store, no pass
/table-dev?phase=bidding&role=player&bids=round   # who bid what, against bots (PID-214)
/table-dev?phase=playing&role=player&trick=bots  # bots say what they played (PID-214)
/table-dev?phase=playing&role=player&out=one&count=on # out of trumps, face-down pile, Last trick
/table-dev?fixture=fold&count=on               # count-only folds: West, North, then you; clears and loops (PID-269)
/table-dev?fixture=fold-legacy&count=on        # same loop with old revealed_cards payloads; no faces rendered
/table-dev?phase=bidding&role=player&deal=true&dealer=north # clockwise packets, unsorted hand → sort → bid
/table-dev?phase=bidding&role=player&deal=cold      # reconnect: already-dealt hand, no replay
/table-dev?phase=second_deal&role=player&dealer=south # dealer sees the authoritative pool and keeps six
/table-dev?phase=second_deal&role=player&dealer=north # public symbolic pack; dealer count stays concealed
/table-dev?phase=auto_rob&role=player&dealer=south # automatic dealer-only combined pool
/table-dev?phase=auto_rob&role=player&dealer=south&clear=true # reveal, then rebuild the sorted six-card hand
/table-dev?phase=ready-host&role=spectator        # spectator sees no controls
/table-dev?phase=playing&autoplay=true            # played-card persistence
```

`table-fold`, `table-fold-legacy` and `table-fold-reduced` check the pile counts,
back images, containment and the still-active East hand at 390×844, 375×667,
844×390 and 768×1024. The loop folds at 1.2/2.1/3 seconds, holds until 16 seconds,
clears with the hand, and restarts at 18 seconds. Reduced motion shows the piles
without a flight; joining an already-cold table does not replay the fold.

PID-290: `/table-dev?fixture=fold-trick&count=on` reconstructs the supplied JA36 hand 5
geometry (not a full archive replay):
hearts trump, trick 4: Jocke (North, your partner) leads 6♥, Antti (West)
plays the winning 9♥ at 0.7 seconds and folds his remaining 8♦ 2♠ at 1.2 seconds.
The fixture holds that partial trick with authoritative winning metadata and no next
turn; surrounding hands/counts are placeholders. The report did not supply tricks
1–3, so their cards are omitted rather than invented.
`fixture=fold-trick-self` is a separate synthetic completion: North leads 6♥,
East plays 8♥, you play 9♥ at 0.7 seconds, West plays 7♥ and the trick completes
at 1 second. Your 8♦ 2♠ fold at 1.2 seconds, leaving your winning card and glow
in the completed trick, with your seat saying Out. Both clear at 16 seconds and
loop at 18.
Grammar cases `table-fold-trick` and `table-fold-trick-self` run at the same four
sizes. They compare every folded image's transformed bounds with every rendered
played-card sprite (including retained history), and require each fold to stay in
its seat's hand area. The same assertion runs on `fold`, `fold-legacy`,
`fold-reduced`, `out=one` and `out=lone`. North and side folds use 82% of their
held-back size at the existing hand origin, leaving space for the slight rotation;
your fold keeps the compact pile size, centered where your hand was.
In landscape North's held fan intentionally bleeds offscreen; its folded stack
tucks just below that edge, to the left of the avatar/name/level rather than over them.
Second-deal throws still land in the trick area and clear before play.

`/table-dev?fixture=play-motion` loops right-end, left-end and middle plays through
the production play-presentation hook and sprite pool, with a local fake server.
Replies take 800 ms; the fourth card completes the trick and the server-selected
leader differs from its winner. `autoplay=false` leaves the hand for real taps;
`play=right|left|middle` fixes the loop's card. `reply=fast|reject|early-reject|timeout|late`
exercises confirmation during flight, rejection after/before landing, no reply and
confirmation after rollback. `reply=burst` puts opponent updates 80 ms apart;
the left-card grammar case uses it to catch lights advancing during overlapping flights.
`transition=0|80|1500|3000` varies the snapshot's hold;
the cancelled/new turn-timer events follow separately. Grammar cases
`table-play-right`, `table-play-left` and `table-play-middle` check immediate
departure, stable sprite identity and the ring through trick completion at
390×844, 375×667, 844×390 and 768×1024. Completed cards still remain as hand history.

PID-279 extends that same loop with lift/settle, spring hand closure and a
post-hold gather/sweep, currently off pending a team decision. Set
`TRICK_SWEEP_ENABLED` in `animationTiming.ts` to try it; grammar assertions follow
that flag, checking visible history by default and collection when enabled.
Each cycle changes the winning seat; `sweep=north|east|south|west`
fixes its destination independently of the next turn. `table-motion-north|east|south|west`
and `table-motion-reduced` check the hold, landing, collection direction and retained
history slots at the same four sizes. In dev only, `__pidroCardMotion()` samples the
sprite shared values on demand (no per-frame React updates), for frame-time traces.
The 100ms gather and 220ms sweep add no delay to the server-selected next turn.

---

## `/ui-dev` — DS v2 gallery

| URL                                                                     | Shows                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/ui-dev?state=components`                                              | Type scale, BevelButton (wood/glass × sm/md/lg/hero/icon, loading, disabled), Input wells, AuthProviderButtons, bevel swatches, legacy Button, DecisionWindow, friend rows, info cards and notices (`ui-friend-rows-panel`, `ui-friend-notices-panel`). testID `ui-foundation-panel` |
| `/ui-dev?state=new-table&fixture=setup\|partner\|bots\|opened\|ready\|louisiana\|requirement\|password\|picker\|friends\|guest\|declined\|live-picker\|live-friends\|live-error` | Shared setup/live team list. Setup testID `new-table-screen`; live (`opened`, `ready`, `guest`, `declined`, `live-*`) `waiting-table`. Rows `new-table-seat-north/south/east/west`; south is Partner, east/west opponents. `guest` is a nonhost, not an anonymous account. `declined` (PID-254): Maija said Not now, so south is open and the host sees "Can't come" (`seat-declined-notice`) at the top, in the footer on a small phone; Invite someone else opens the friend picker for south. `live-picker` opens the picker on the west password seat of an opened table, `live-friends` the friend list on south (Maija held); a fixture server applies each choice like `PUT /rooms/:code/seats/:position`. `live-error` fails Bot outright (the reason shows inside the picker) and answers any other choice with `SEAT_NOT_VACANT` after seating Eli there (the picker closes and the reason stays in the footer). |
| `/ui-dev?state=progression`                                             | Progression HUD primitives: PlayerAvatar (sizes, no photo), RatingPlaque, LeagueProgress, CtaBadge. testID `ui-progression-panel`                                                           |
| `/ui-dev?state=avatars`                                                 | PlayerAvatar: rings, pins, sizes 104–24, every seat state from the Seat-States board, label below/right/left. testID `ui-avatars-panel`                                                     |
| `/ui-dev?state=seat-rows&fixture=setup\|setup-open\|opened\|opened-more` | New table seat rows (PID-243): every state before and after the table opens, four seats at a time; landscape puts the teams side by side. testID `ui-seat-rows-panel` |

This route is the pixel-diff baseline source. Change a token or primitive → it drifts →
refresh with `bun run ui:baselines <runId>`.

`/ui-dev?state=seat-picker&fixture=choices|friends|many|empty` previews PID-244's
`ChoiceList`, `FriendPicker` and `SeatPickerContainer`. The container chooses a
portrait sheet, landscape full screen or centered tablet panel; `many` supplies
30 friends, and `locale=sv` previews owned Swedish copy. The `ui-seat-picker-*`
grammar cases cover 390×844, 375×667, 844×390, 768×1024 and 1024×768, including
keyboard selection, unavailable rows, search, one-tap invite/close and internal
list scrolling. Browser checks do not certify native keyboard or safe areas.

Callers pass choice sections (including optional short subtitles), a selected ID,
and friends whose section and availability have already been mapped from server
state. `groupPickerFriends` only groups and name-filters those entries. Neither
list fetches or reads server presence. The container calls the selection callback
then `onClose`; a deeper row opens the full-height friend page on portrait phones.
Use that row's subtitle for the chosen friend's name, and remount the container
for a new presentation. The new-table screen consumes these same primitives.

`/ui-dev?state=lobby-seats` shows lobby seat requirement samples using the same
seat payload as the live lobby.
`node scripts/verify-lobby.mjs` checks the real lobby with mocked API responses at
six viewport sizes, including direct seat joins, search, create, error states, the
empty Tables screen (start a table, join with a code, the quick game Home also starts)
and the badge gallery. Captures go to `/tmp/pidro-lobby` (or `UI_SHOT_DIR`).

`node scripts/verify-create-room.mjs` covers all fourteen new-table fixtures at
390×844, 375×667, 844×390, 768×1024 and 1024×768, and on the `live-*` ones taps each choice,
checks the row the server answer gives and that the picker reopens on it. Grammar
case names are `new-table-setup`, `new-table-partner`, `new-table-bots`,
`new-table-opened`, `new-table-ready`, `new-table-louisiana`, `new-table-requirement`,
`new-table-password`, `new-table-picker`, `new-table-friends`, `new-table-guest`,
`new-table-live-picker` and `new-table-live-friends`.
Upright the root is a centered column (436 on a phone, 660 on an iPad); sideways the two
teams sit side by side with `vs` between. Nothing scrolls; the picker's friend list scrolls
inside itself and shows four whole rows of two on a 390pt-tall phone (`dense` `FriendRow`).
Add `&safeArea=island-left|island-right` to fake a notch on either side in a browser.
Setup seats are all open, with Ostrobothnian/Louisiana ActionPill radios. Footer actions
are Open the table, Start the game (three bots), Share the table link (opened),
and I'm ready (full). The picker has five subtitle-named radios: Anyone, Bot,
100+ games played, 1000+ games played, With password, plus the deeper A friend row.
Live seats without a person offer the same choices, opened on the server's current one. Occupied rows open
kick confirmation, never move/lock controls. `waiting-rule-set`,
`waiting-rules-menu` and the Louisiana explainer remain supported.
The creation script also drives the real lobby entry with mocked API responses,
checks all-open defaults, Partner → `seat_3`, requirement payloads and retry after
a refused creation. Locale waiting cases now use `state=new-table&fixture=opened`.
The old `create-*`, `friend-seat-*` and `create-safe-area` fixtures are retired,
including the modal-only safe-area structure test. Captures go to
`/tmp/pidro-create` (or `UI_SHOT_DIR`). Browser checks do not certify native safe
areas or keyboard avoidance.

## Shell friend notices

PID-276: `/home?fixture=waiting` puts three incoming requests on both the avatar
and Friends tab. `/home?fixture=invitations` also shows the avatar's seat count,
including with guest auth (no tab). `/profile?fixture=list|empty` shows the full
Friends row with six or zero friends; tapping it opens Friends with Back to Profile.
`/friends?fixture=list&from=profile` opens that header directly. Plain tab entry has
no Back. Guests dismissing the Friends sign-in sheet return to their entry screen.
Grammar cases `home-waiting`, `home-waiting-guest`, `profile-friends`,
`profile-friends-zero`, `friends-from-profile` and `profile-friends-guest` check the count, visible controls
and return/tab navigation at 390×844, 375×667, 844×390 and 768×1024. Long profiles
and friend lists retain their existing scrolling.

Home and the tab use the server's `waiting_for_you` total for signed-in players,
even when a refused seat join has cleared the local invitation cache. Guests count
their cached seat invitations; they cannot have incoming friend requests.

`/home?fixture=friend-request|friend-accepted|friend-linked|friend-seat|friend-offline|friend-queue|friend-too-late` shows the
real shell notice and Friends badge without a backend. Accepted and too late stay visible in
the fixture for capture; live ones disappear after four seconds. Too late (PID-254)
replaces a seat notice whose seat went because the game started, the host let it go or
the room closed, and after a refused Sit down; it has no buttons and no badge.
Linked (PID-247) is the notice after signing up through someone's own link, which sends them
a friend request: "Request sent. You'll be friends once Nora accepts.", with no buttons.
On a seat notice Not now declines the seat for real. Home also holds that seat's invitation,
which it does not list a second time while the notice is up. Offline is the seat notice whose
Not now fails: "Couldn’t send that. Try again." under the buttons, and the notice stays. The queue
fixture starts with a seat, then a request, then accepted. Not now closes only the
prompt, keeping the badge. These fixtures also work on other shell tabs. Grammar
cases `friend-notice-*` check containment, touch targets, tab clearance and queue
order at 390×844, 375×667, 844×390 and 768×1024. Browser sizes do not certify
native safe-area measurement.

## Shell update notice — "A new version is ready"

`/home?fixture=update-notice` forces the shell's update notice on. It works on any
shell tab (`/settings?fixture=update-notice` too), because the notice lives in the
shell layout, not in a screen; the gallery cannot show it in place. Restart only shows its busy state here; nothing reloads. Dismiss hides it.
Add `safeArea=island` (or any `/table-dev` preset) to fake insets for the whole shell.
testID `update-notice`.

The notice floats over the screen just above the tab pill (above the bottom safe area
beside the landscape rail or for guests) and never covers a control. Scrolling screens
learn how far up it reaches through `usePillClearance` (or `useNoticeInset` when they
already clear the pill or safe area: guest Friends, Home's invitations) and scroll their
last row clear of it. Home's play tiles reach the bottom and Home does not scroll, so
Home places it itself with `UpdateNoticeSlot`: at the top of the logo stage, under the
header, where no control reaches. Nothing moves when it shows or goes.

The UI-grammar case `update-notice` opens `/home?fixture=update-notice&safeArea=island`
in every viewport (375×667 included) and checks that no control sits under the notice,
that it is clear of the tab pill, has 44pt Restart and Dismiss targets, that Restart goes
busy and cannot be tapped twice, and that dismissing it moves nothing on Home. It then
opens `/settings?fixture=update-notice&safeArea=island` and checks the notice floats
above the bottom inset, the last row scrolls clear of it and no control sits under it.
`update-notice-friends-guest` does the same for a guest on Friends, and
`update-notice-home-guest` for a guest on Home.

Every Home case (including 667×375 for `home`, `home-guest` and the notice cases)
hit-tests the header's controls and both play tiles: each must take its own taps. In
landscape a guest's column (tiles, Classic plaque, Sign in) is taller than the space
beside the logo once there are insets, so it scrolls there instead of covering the header.

In a release build the notice shows by itself once Expo has downloaded an update, and
never on the game screen. The real path (check on foreground, download, reload) needs a
release build on a device; Expo Go and web have OTA updates disabled.

## `/auth-flow-dev` — guest-first auth

Accepts the bounded locale parameters above. Includes gates that open `AuthSheet` (`multiplayer`, `friends`, invite link)
and the post-game `KeepProgressPrompt`. Deliberately outside the auth guard. testID
`auth-flow-dev`.

## `/claim-classic?fixture=<state>` — Classic claim

The real claim screen with deterministic presentation states and no backend mutation. States:
`method` shows the three sign-in choices; `login` shows only Classic credentials;
`preview` asks "Is this you?" with the Classic name and games/level/since;
`password` asks for a new password, keeping ThunderThor88 and the Classic email;
`rename` puts the replacement public name on the details step. `already-claimed`
offers sign-in and its hint only when signed out; an existing player can go back.
Use an authenticated guest fixture to check that guest games come along.
"Yes, that's me" opens details only when the claim needs something typed; otherwise
it claims directly. Header back goes details → preview → method, or login → method.
For Swedish use `/ui-dev?state=claim-classic&fixture=password&locale=sv`.
testID `claim-classic-screen`; the window is `classic-claim-window`.

`details` offers neither login value, `rename-details` also requires a public name,
and `taken` shows both offered values refused with their field errors. Three or four
inputs pair up inside the window, keeping their usual size. These fixtures also run
in English and Swedish at all four sizes.

PID-289 grammar cases cover these steps, signed-out/guest/account variants and Swedish
at 390×844, 375×667, 844×390 and 768×1024, plus Classic forgot and code entry.
They check no scrolling, 44px targets, no inputs on the preview, no providers on login,
and the last-in-window wood action: 60px on phones, 54px in landscape, 64px on tablets,
identical across steps at each size. Resend is a link outside the code window.

## Account flow — sign in, create account, Classic recovery

Real screens with deterministic states; `?fixture=` is read in development only and
never calls the backend. All sit on the `AuthFlow` scaffold, so each one has a phone,
a phone-landscape and a tablet layout.

| URL                                       | Shows                                                     | testID                  |
| ----------------------------------------- | --------------------------------------------------------- | ----------------------- |
| `/login?fixture=providers`                | Sign in with Apple and Facebook forced on                 | `auth-window`           |
| `/login?email=a@b.co&known=1`             | Sign in after Create account hit an address in use        | `auth-window`           |
| `/register?fixture=providers`             | Pidro account: providers and the email step               | `auth-window`           |
| `/register?fixture=password`              | Create a password                                         | `auth-window`           |
| `/register?fixture=name`                  | Pick your name                                            | `auth-window`           |
| `/register?fixture=email-taken`           | Create account email step: address already has an account | `auth-window`           |
| `/register?fixture=name-taken`            | Pick your name: taken, with the Classic claim plaque      | `auth-window`           |
| `/classic-forgot`                         | Forgot Classic password                                   | `classic-forgot-window` |
| `/classic-forgot?fixture=code`            | Six-digit sign-in code entry                              | `classic-code-window`   |
| `/classic-forgot?fixture=code-invalid`    | Invalid code notice; field cleared and focused            | `classic-code-window`   |
| `/classic-forgot?fixture=unavailable`     | Link service down; points to help                         | `classic-forgot-window` |
| `/classic-forgot?fixture=not-found`       | No Classic account matched                                | `classic-forgot-window` |
| `/classic-help`                           | Ask support to find a Classic account                     | `classic-help-window`   |
| `/classic-help?fixture=filled`            | …with the form filled in                                  | `classic-help-window`   |
| `/classic-help?fixture=sent` / `=mail`    | Sent, or handed to the mail app                           | `classic-help-sent`     |
| `/reset-password?token=x&fixture=refused` | Reset link the server refused, offering a new one         | `auth-window`           |
| `/forgot-password?fixture=sent`           | Password reset requested                                  | `auth-window`           |

Use a guest auth fixture to see the guest wording ("Your guest games come with you").
On a simulator these open through the dev deep-link allowlist in `app/+native-intent.tsx`
(`exp://127.0.0.1:8081/--/classic-forgot?fixture=code`). A fixture is read when the
route mounts, so switching between two fixtures of the same route needs an app restart.

## `/age?fixture=<state>` — age gate

`unanswered` (no range chosen, Continue disabled), `selected` (18 or older chosen,
Continue enabled), `under13` (the stop screen). testID `age-screen`, or
`age-stop-screen` for `under13`.

## `/home?fixture=table-unknown`

Home after Quick game was refused as "already in a room" and the lobby that would
say which table could not be loaded: nothing was left, and the player can tap again.
testID `home-screen`.

## `/game/<code>?fixture=away`

The away screen that replaces the table after the server removed the player for
missed turns: a bot is taking the seat, I'm back joins again. testID `game-away-window`.

`fixture=joining|restoring|loading` holds each real game loader for capture, including
the Skia import loader. testID `game-loading-screen`. The `game-*` grammar cases and
`edge-{home|profile|table|hand-log}-android-{gesture|buttons}` cover 390×844,
375×667, 844×390 and 820×1180. Edge cases use synthetic insets, check full-viewport
image coverage and the hand-log backdrop, and do not certify Android system bars.
The native modal measures its own insets, independently of the route's fixture.

## `/join/<code>?fixture=open`

Renders the invite preview with no backend.
Canonical: `/join/7KQ4M2XB?source=copy&fixture=open` — testID `join-invite-window`.

## `/lobby?fixture=<state>` — player-first table rows

Development-only, backend-free fixtures; use an authenticated auth fixture.
`list` shows all categories: MY has Rejoin; OPEN1 has Claas and three open seats;
OPEN2 has Yaya, a bot and two open seats; SUB has Anna/Pekka/Liisa and one Sit in;
WATCH1 and the other playing rows have Watch. Table names, codes and levels are
not displayed. `rejoin`, `open`, `substitute`, and `watch` isolate each row kind.
`empty` shows the empty Tables screen. `search-empty` starts with an unmatched
player query and offers Clear search. Search is labelled **Find a player** and
matches human player names, not table names, codes or bots.

`badges` shows open tables with 100+ and 1000+ chairs for a 1500-game player.
`locked` shows the same tables for a 40-game player; tap a dimmed chair for the
five-second inline reason. `watch` includes “Hand 4 · 34 to 21” and older-payload
“Playing” rows; `substitute` shows “Jussi left in hand 3” using the current hand.

`password` adds Bertil's table, whose south chair is a password seat with the gold
lock (PID-259); tap it for the keypad. `password-keypad`, `password-typed` (48 typed),
`password-wrong` and `password-wait` open the keypad in that state. A fixture keypad
answers every password wrong, so typing four digits walks through the shake.
`&safeArea=island-left` or `island-right` fakes the landscape insets inside the panel.
Grammar cases: `lobby-password`, `lobby-password-keypad`, `lobby-password-typed`,
`lobby-password-wrong`, `lobby-password-wait` (phone, small phone, landscape,
667×375 and iPad portrait) and `lobby-password-island-left|right` (landscape).

Grammar cases: `lobby-list`, `lobby-empty`, `lobby-rejoin`, `lobby-open`,
`lobby-badges`, `lobby-locked`, `lobby-substitute`, `lobby-watch`, `lobby-search-empty`. They cover the phone
viewports plus lobby-specific 834×1194 and 1194×834 tablet sizes. The existing
`home-tablet-portrait` and `tablet-landscape` CI shards apply those sizes only to
lobby cases; other screens keep their existing dimensions.

## `/friends?fixture=<state>` and `/friends-add?fixture=<state>`

Use an authenticated fixture. Friends has `empty`, `list` (the `Friends` board:
Nora 1 seat open, Kalle hand 4, Hanna yesterday, Mikko last week, Sanna in September,
Pekka asked today, Liisa 3 days ago, Eero sent 2 days ago), `added-you`, `loading`, `error`, and `classic` (seven Classic friends not here yet).
`all` shows all five sections, with Join, Play and no-action online rows, incoming
and sent requests, last played and Classic. Ignore/Undo, Accept and cancel work
locally in this fixture. `friends-all` checks it at 390×844, 375×667, 844×390 and
768×1024, including toast dismissal. Long lists scroll clear of the tab pill.
Tap a row in `list` for the short friend sheet, with a fixture profile level.
See full profile opens the profile without Remove or Block; table profiles keep
their existing actions. `sheet-partner`, `sheet-opponent`, `sheet-full`,
`sheet-online`, `sheet-bots`, `sheet-offline`, and `sheet-request` open each
situation directly. `sheet-remove` and `sheet-block` open the inline confirms.
The `friends-sheet-*` grammar cases cover these at 390×844, 375×667, 844×390
and 768×1024, plus Swedish previews through `/ui-dev?state=friends&fixture=sheet-partner&locale=sv`.
No sheet fixture writes to the backend. Add a friend has `recent` and `results` (all four server relation states,
the Send your link card, and working local Add/Accept transitions). The gallery
`/ui-dev?state=friends-add` defaults to `recent`. Empty Friends has three recent
players and a Classic count; adding keeps those rows in place. Recent rows carry
`played_together_at` ("Played together today" on Add, "Today" on empty Friends);
without it a row falls back to presence. Fixture dates count back from now, so the
words stay the same every day; only the month form ("in September") uses a fixed date.
The three discovery grammar cases cover 390×844, 375×667, 844×390 and 768×1024.
The guest route opens the account sheet and continues on Friends after saving.

Grammar cases: `friends-empty`, `friends-list`, `friends-added-you`,
`friends-loading`, `friends-error`, `friends-profile`, `friends-remove`,
`friends-block`, `friends-recent`, `friends-results`, `friends-guest`, and
`friends-classic`. The Classic case checks the count below the list and the app-share
payload, including share failure and retry; it never opens a real share sheet.
Every Friends state ends with the Send your link card (PID-247); `friends-classic`
checks it sits below the Classic card and shares the player's own link.

`link-profile` opens Nora's profile as her own link (`/play/<slug>`) opens it for
a signed-in player who is not her friend yet: Add, then Sent, without the backend.
Grammar case `friends-link-profile` covers 390×844, 375×667, 844×390 and 768×1024.

## `/blocked-players?fixture=<state>`

Authenticated fixtures: `empty`, `filled`, `loading`, `error`. The filled list
has no presence labels; Unblock is inert in fixtures. Grammar cases are
`blocked-empty`, `blocked-filled`, `blocked-loading`, and `blocked-error`.
`friends-block` opens the confirmation from the short friend sheet. The
`block-profile-playing` and `block-profile-game_over`
cases open a human profile through `/table-dev?phase=<phase>&role=player`, mocking
only the profile response. `block-profile-guest` checks that guests see no Block
action in the post-game sheet.
The old waiting profile-entry case is retired: occupied new-table rows open kick
confirmation, not a profile.

## Rule-set fixtures

Development-only, no backend needed (except the real manual-code path, mocked by
the grammar script). Invite routes
show a guest name-entry preview without auth, or the same table's confirmation
with an authenticated fixture.

| URL                                                            | Shows                                                            |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `/ui-dev?state=new-table&fixture=setup` / `fixture=louisiana` | Selected setup rule radios |
| `/ui-dev?state=settings&fixture=finnish` / `fixture=louisiana` | Preferred rules selector                                         |
| `/join/7KQ4M2XB?fixture=finnish` / `fixture=louisiana`         | Rules badge in guest preview or authenticated confirmation       |
| `/join/7KQ4M2XB?source=typed&fixture=louisiana`                | Manual-code arrival at the same confirmation                     |
| `/table-dev?fixture=louisiana`                                 | Playing table badge; Table settings → Table rules                |
| `/table-dev?fixture=louisiana-bidding`                         | Server minimum bid 7; badge clear of the bid grid                |
| `/table-dev?fixture=louisiana-explainer`                       | First-encounter rules explainer, four facts, feedback and Got it |
| `/table-dev?fixture=louisiana-game-over`                       | Game over shows no rules badge (PID-292)                         |
| `/table-dev?fixture=louisiana-waiting`                         | Waiting rules badge and Table rules action                       |
| `/table-dev?fixture=louisiana-waiting-explainer`               | Waiting first-encounter explainer; dismiss and reopen            |

The actual `/join-code` form routes to `/join/7KQ4M2XB?source=typed`;
`manual` is **not** a valid arrival source. It ends at the same authenticated
confirmation as an invite link, not a separate manual-code confirmation screen.
`join-code-louisiana-confirm` exercises that form with a mocked Louisiana preview.

Grammar cases: `new-table-setup`, `new-table-louisiana`,
`settings-finnish`, `settings-louisiana`,
`join-finnish-preview`, `join-finnish-confirm`, `join-louisiana-preview`,
`join-louisiana-confirm`, `join-louisiana-manual-confirm`, `join-code-louisiana-confirm`,
`table-finnish`, `table-louisiana`, `table-louisiana-bidding`, `table-louisiana-explainer`, `table-louisiana-game-over`,
`table-louisiana-waiting`, `table-louisiana-waiting-explainer`.
New-table cases use the four sizes documented above; other rule cases run at
390×844, 844×390 and 667×375. Ostrobothnian playing and waiting
cases also check badges; playing/waiting reopen the rules from the menu
and capture an additional `-rules-reopened.png` screenshot.

PID-273's `words-en-*` and `words-sv-*` grammar cases reuse these fixtures for the
header flag, settings selector, new-table pills, bot waiting room
(`/table-dev?fixture=finnish&phase=ready-solo`), losing game-over team headings and
compact lobby badges (`/ui-dev?state=lobby-seats`). The lobby cases also check that
the longer rule label leaves a clear gap before the seat count.
They check the red/yellow flag, Ostrobothnian/Österbottnisk and Us/Them (Vi/Dom)
at 390×844, 375×667, 844×390 and 768×1024. The internal rule value stays `finnish`.

---

## Scripted checks (Playwright against Expo web)

Needs Expo web running (`bun run web`) and, once per machine,
`bunx playwright install chromium`.

```bash
bun run test:ui            # full viewport matrix, touch targets, containment
UI_CASES=table-bidding,home bun run test:ui      # just these
UI_SHOT_DIR=/tmp/shots bun run test:ui           # where screenshots land
UI_PARTITION=1/10 UI_REPORT_PATH=/tmp/ui-report.json bun run test:ui  # one CI-sized batch
node scripts/verify-ui-grammar.mjs --list        # selected viewport/case IDs, no browser
MOBILE_BASE_URL=http://localhost:8081 node scripts/verify-seat-decisions.mjs
node scripts/verify-waiting-seats.mjs   # 4 target sizes; shared list, readiness, kick and live choices
node scripts/verify-profile.mjs
node scripts/verify-dealing.mjs  # four dealers, 3/6/9 receive order, sort/bidding timing, reconnect, reduced motion
```

`bun run test:ui:diff` (pixel diff) is **CI-only** — baselines are Linux Chromium
renders, so Mac captures flag font/antialiasing noise. Adopt intentional drift with
`bun run ui:baselines <runId>`.

CI balances the full matrix across ten jobs using Linux case durations in
`scripts/ui-case-costs.json` (last calibration: Actions run `39359720639`).
New cases use the median recorded duration and are still included.
Refresh the weights from a successful run's `ui-report-*`
artifacts (each record's `id` maps to its `ms`); local Mac timings are not comparable.
The aggregate checks that every case completed exactly once and its capture
exists, then compares all committed baselines. Its job summary lists the slowest
cases so future tuning can use measured costs.

`UI_CASES` names: `home` `home-guest` `home-table-unknown` `game-away` `profile` `profile-guest` `profile-badges` `settings` `league` `lobby-list` `lobby-empty` `lobby-rejoin` `lobby-open` `lobby-substitute` `lobby-watch` `lobby-search-empty` `login` `register` `register-password`
`register-name` `classic-forgot` `classic-code` `classic-code-invalid` `classic-help` `join-code` `join-invite`
`ui-components` `new-table-setup` `new-table-partner` `new-table-bots` `new-table-opened` `new-table-ready` `new-table-louisiana` `new-table-requirement` `new-table-password` `new-table-picker` `new-table-friends` `new-table-guest` `table-waiting` `table-ready` `table-ready-host`
`table-waiting-host` `table-invite` `table-waiting-notice` `table-playing` `table-notice`
`table-reconnecting-banner` `table-dealer-selection`
`table-completed-trick` `table-bidding` `table-trump` `table-hand-selection`
`table-game-over`

Grammar viewports: portrait 390×844 · landscape 844×390 · compact-landscape 667×375.

---

## Simulator

```bash
just table-sim "iPhone 17 Pro" bidding   # one sim, deep-linked
just table-matrix bidding                # iPhone 16e, 17 Pro Max, iPad mini, iPad Pro 13 (heavy)
just table-shots [outdir]                # screenshot every booted sim → screenshots/matrix/
xcrun simctl io booted screenshot out.png
bash scripts/table-matrix.sh rotate left bidding   # rotate + remount so layout follows
```

Rotation needs the remount — Expo Go keeps `useWindowDimensions` stale otherwise.
`simctl io screenshot` always captures device-native orientation, so a landscape
capture comes out portrait-shaped; rotate the PNG.

> **Web has zero safe-area insets.** `safeArea=` fakes them so a browser can approximate
> a device. On a simulator `/table-dev` uses the REAL insets — never pass `safeArea=`
> there, it would hide the clearance you are checking. Overlay clearance, gestures and
> rotation are only proven on a device.
