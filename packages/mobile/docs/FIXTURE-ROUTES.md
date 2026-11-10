# Pidro fixture routes — cheatsheet

Dev-only routes (`__DEV__` guarded; they redirect to `/home` in release). No login,
no backend, no playing a game to reach a state. Print and tape.

**Feature-orb policy:** prove the changed states and a control at one standard phone
size, adding one other size only for a named layout risk. Full matrices/multi-journey
and native runs below are **release/manual recipes**, not a checklist for every
feature. Native verification belongs to Marcel's machine or deliberate release work.
See [`docs/testing.md`](../../../docs/testing.md); freeze Metro inputs during captures.

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

| Parameter         | Meaning                                                   |
| ----------------- | --------------------------------------------------------- |
| `locale=en\|sv`   | Initial displayed copy, independent of the selected radio |
| `language=en\|sv` | Initial selected language preference (ephemeral)          |

Settings offers English and Svenska only. A new install, or a `system` saved by an
older build, takes the device's language once in the settings store and saves it
(`packages/shared/test/i18n.test.ts`); there is no device-language fixture.
Explicit `locale` wins initially, allowing either selected option to be inspected
in either language. Selecting a radio immediately shows the ephemeral choice.
Neither mount nor selection writes the real language preference. Settings
notifications preserve the focused fixture override; blur/unmount restores the
persisted real preference. The boundary has no locale key and never remounts a game.
Without params, copy starts from the real preference; fixture language selection
is still ephemeral.

Examples: `/ui-dev?state=settings&locale=sv&language=en`,
`/table-dev?phase=declaring&locale=sv`, `/auth-flow-dev?locale=sv`.

The second deal loops at `/table-dev?deal=draw`, fed the snapshots the server
sends (trump named, then the hand ready to play, play held while the table
shows the second deal). It plays at Classic's pace: each player in turn from
the dealer's left throws their non-trumps face down in front of them, the
piles hold to be counted and clear, the dealer gives each player their cards
one at a time, takes the rest and throws down to six last (`dealerHoldMs`).
Throws are backs for everyone, the thrower included, as many as each player
threw; the dealer alone sees the pool they took up less the six they kept face
up for `dealerHoldMs`, everyone else as many backs as the server's
`discarded_count` (PID-307). A server without it shows no dealer's throw.
The dealer deals from a pack beside them (PID-394): the first deal leaves it
16, it rests through bidding and the trump call, counts down as the dealer
gives, and slides to the dealer as they take the rest. Upright, your pack
lies bottom left, under your hand, since talk has the bottom right corner. West deals unless
`dealer=north|east`; `you=deal` has you deal; `kill=1` has East keep seven trumps and kill the
queen, face up in East's front row for everyone until the first card lands
(`killed_cards`); `hand=still|tilt|fan` tries how hands hold their
cards. **Tune** opens live timings (each change replays); the link takes the
same keys, e.g. `&holdMs=3000&cardMs=230&throwGapMs=550`. The server's
`second_deal_transition_delay_ms` must hold play for the whole of it.

The end of a hand loops at `/table-dev?deal=hand`: the last trick, the
hand's result, and the next hand dealt once it closes (the server sends the
next hand with the one that ended; the table holds the ended hand meanwhile).
`end=they-made|we-made|we-missed|they-missed`; **Tune** changes how long the
result stays (`showMs=` in the link). The server's `hand_transition_delay_ms`
must cover the result and the deal. `count=on` shows the PID-236 panel; without
it the hand ends as Classic's did (PID-332): ours | theirs over the trump mark
between the hand's cards, which clear halfway through `showMs`. `pace=own`
waits for a tap. Grammar cases `table-hand-classic`
(`end=we-missed&showMs=600000`, −10 | 6 among 16 cards) and
`table-hand-classic-alone` (`end=we-made&pace=own&showMs=0`, 8 | 6 alone) cover
both beats at 390×844, 375×667, 844×390 and 768×1024.

A settled hand loops at `/table-dev?fixture=lay-down` (PID-366): the last
real trick taken and the other three out of trumps, then two seconds later the
server settles the hand in one revision, straight into the next hand's bidding
(`last_hand.settled`, `transition_delay_ms` 13 500). The holder's trumps turn
face up in a fan in front of their seat, hold, gather to their pile, and only
then the result and the deal; it plays again once that transition is over.
`by=north|east|west|south` (south is you, your cards rise from your hand),
`cards=2|5`, `count=on` for the points on the fan and the result's panel.
Grammar captures hold on the fan:
`table-lay-down-{north-5-count-en,north-2-sv,east-5-sv,east-2-count-en,west-2-en,west-5-count-sv,south-5-count-en,south-2-sv}`
check that every card lies face up on screen and clear of every seat, that the
holder says "Takes the rest", the fan's points, that the result and the next
hand's bid window wait, and that your laid cards left your hand, at 390×844,
375×667, 844×390 and 768×1024.

Upright phones draw cards as big as Classic's (PID-333). Grammar cases
`table-upright-bidding|second-deal|trick|hand-end|hand-classic` (`phase=bidding`,
`deal=draw&holdMs=600000`, `trick=full`, `deal=hand&count=on`, and Classic's end)
check at 390×844 and 375×667 that no seat, back fan, pile, throw, the trump
mark or your hand touches another, that East's and West's backs end TRICK_GAP
above a lifted card of yours, and print the card heights and (PID-393) where
East's and West's avatars sit against the trick's line.

PID-381, upright phones: each seat's newest card lies in front at full size,
its earlier cards this hand behind it at 0.8 of that and shaded (point cards
keep their light with `count=on`), each showing 0.26 of a card, its rank and
suit; a long pile closes its oldest cards toward 0.16 first. North's and yours
run along the circle, East's and West's hang down their column. Each side
card points its top at the middle (PID-388), so East's index lies at the foot
and West's at the top: East's newest card lies on the trick's line with its
earlier ones below, West's oldest there and its newest at the foot.
`/table-dev?fixture=piles&cards=1|3|5|6` has every seat play that many cards
(at 6 East put two into the first trick), the current trick all four down;
`led=east` has East alone lead it, `you=out` has you out before it, `next=on`
has West lead the next trick 2.5 s in, its last card settling back. Grammar
cases `table-upright-piles-{1,3,5,6,5-count,6-count,5-led,5-out,settle,settle-reduced}`
run at 390×844, 375×667 and 360×780 (the TCL's `android-portrait`): every card
of every pile against every other thing, the newest full size, the earlier
ones one smaller size, the shade, at least 0.16 of a card each and on 390×844
up to five deep the whole index, and the settle's timing (one cut with Reduce
Motion). Tablets keep their fan.

PID-214 bid presentation uses `/table-dev?phase=bidding&role=player&bids=round|high&locale=sv`.
`table-bid-*` and `locale-sv-table-bid-*` check every seat's visible/spoken bid,
the high-bid tone and compact south status without changing bid event identities.

Flaky connections use `/table-dev?phase=playing&fixture=flaky-offline&locale=en|sv`.
Replace `offline` with `auto-card`, `auto-pass`, `auto-bid` or `late-card` for the
quiet notices, or `spectator&role=spectator` for all four hands of card backs.
PID-364 adds `late-tap` ("Too late, the trick moved on."), `away-one` (10♠ was
played for you while you were away) and `away-out&out=you&botTurn=north` (10♠
and 5♥, and you are out: your cards folded). `early-tap&botTurn=north` is Marcel's
turn: tapping your card says nothing, the card shakes and settles and his shine
lights once (a still capture holds it lit). `out-tap&out=you&botTurn=north`: you
are out, and a tap on your folded cards does nothing at all.
`table-flaky-{offline,auto-card,auto-pass,auto-bid,late-card,late-tap,away-one,away-out,early-tap,out-tap,spectator}-{en,sv}`
checks the band, no scrolling, and all four spectators' hands at 390×844, 375×667,
844×390 and 768×1024; the tap cases tap a card and sample its position every
frame. `table-flaky-early-tap-reduced` holds the card still under reduced motion;
the shine still lights. These are presentation fixtures; socket-drop verification
uses the real game route and local backend.

The sweep (PID-364): `/table-dev?deal=hand&sweep=on&count=on|off` has Eli (East)
alone holding trumps while the server plays his last four out, 500 ms apart,
then the result; `sweep=held` stops after two. `table-sweep-{en,sv}` captures
"Takes the rest" mid-sweep at the four sizes; `table-sweep-hold-count-{on,off}`
reads his line on every frame until the result shows.

Teams (PID-383) use `/table-dev?fixture=teams&locale=en|sv`: you are Mia
(initials), Antti the drawn bot across is your partner, Marcel at West has a
photo and Eli at East none. The score plaque is labels and figures only
(PID-387 took off the faces PID-383 put beside them): 53pt tall, 170pt wide,
upright and sideways. It is the first hand of the game, so Antti's empty line reads
"Your partner"; `fixture=teams-hand2` is the second hand, where it is silent.
`role=spectator` keeps N/S and E/W, N/S's faces first, and no partner line.
Tap a seat for its sheet: "Your partner" or "Plays against you" under the
name, nothing for a spectator. Grammar cases
`table-teams[-hand2|-spectator|-sheet-partner|-sheet-opponent|-sheet-spectator]-{en,sv}`
check that the plaque has no faces, its size and the menu's clearance, that it
still opens every hand, the partner line, and the sheet's
line, at 390×844, 375×667, 360×780 (Android insets), 844×390 and 768×1024.

PID-277 uses `/table-dev?fixture=bot-crew&locale=en|sv`: Marcel is thinking,
and all three drawn bots open their short card through their avatar or nameplate.
It applies the server's seat lifecycle shape: bots have a persona but no account ID.
`table-bot-card-{marcel,antti,jocke}-{en,sv}` checks the copy, Close/reopen,
44pt targets and no scrolling. Game over against the crew shows no rematch row
(bots always agree, PID-292), so the card opens only at the table.
Cards stay closed until tapped. `table-bot-thinking[-antti|-jocke]-{en,sv}`
checks each voice's visible nameplate line and that reloading keeps it.
`botTurn=north|east|west&botHand=1|2|3|4` tries every line of the crew.
PID-408 adds `talk=lines|sheet`: the band is open at a bot table, Gun (warm)
sits East in Jocke's place, and `lines` lands Antti's teasing line at North,
Gun's warm line at East and Marcel's 👍 at West; `sheet` opens the hand of
words, with no typing box, since no other person reads it. Antti's face opens
his card with **Quiet Antti’s words**, which hushes his `bot:antti` lines.
PID-405 adds `character=saga`: North, your partner, is Saga, a catalogue
character who plays `search` and thinks in her own five catalogue lines. The
last is 40 characters, the most allowed: the nameplate cuts it short, and in
landscape North says the plain turn text instead. Her sheet says she plays the
odds, while the three devs, without a strategy, play the honest game.
All run at 390×844, 375×667,
844×390 and 768×1024. Persona keys live beside `BotPersonaFace.tsx` in
`botPersonas.ts`; all editable English/Swedish persona copy is together in
`packages/shared/src/i18n/sections/bots.ts`. These describe the bots at play,
not the real people's biographies or a guarantee about their bidding strategy.

Table talk (PID-114) uses `/table-dev?fixture=talk-quiet|landed|coin|line|sheet|log&locale=en|sv`:
four people at the table (Bengt, Antti, Jocke, Mikko), so talk shows: on phones a speech
bubble in the bottom right corner, upright level with your avatar (PID-393), on an iPad a band
beside the hand. `landed` has your word at your seat, `coin` a coin at North and East and a
word at West, `line` the last line after a landing fades, `unread` the same line come while
the sheet was closed (the bubble wears a dot until it opens), `sheet` the hand of words, `log`
what was said this game. A tap in a fixture lands at once and sends nothing. `table-talk-*`
checks the bubble in its corner, landings clear of every seat's cards, a sheet with no
scrolling and one tap that sends and closes it, at 390×844, 375×667, 844×390, 640×360 and
both iPad sizes.

What talk offers (PID-328) is `fixture=talk-offer` (your partner's trick: Nice trick!,
heart, thumb), `talk-offer-turn` (the same on your turn, dimmed), `talk-reply` (Antti said
Well played: Thanks!, heart) and `talk-start` (Hello!, Good luck). In a fixture the gold line
holds still and the offer stays. Landscape phones keep the card, one coin and the speech button
right of your hand, and drop the coin, then the button, where the hand leaves less room.
Upright phones (PID-396) say the word in the bubble's tail: a cream face joined to the
bubble as one pill, the gold line under them, the word one tap. It takes the room left of the
bubble, 8pt short of your avatar's turn ring, at body size, then the small size (with less
padding), then in two lines ("Nice / trick!"); where none fits the bubble lights alone and
opens the words. Every phone fits Thanks!, so `talk-reply-narrow` holds the room at 64pt to
show that. `talk-offer-slide` holds the tail halfway out of the bubble; your own landing rises
only once the tail has folded. While you deal (`talk-deal-bidding`: Hello! during bidding, your
pack resting), a landscape phone lifts the word card over your pack. Where the pack would meet
the bubble, it stands above your hand's right end (640 wide), or lies bottom left beside your
seat where East's seat comes down there (667 wide). A landscape iPad stands your pack above
your hand's left end.

A face at the table opens that person's player sheet (PID-406); at a talk table its •••
holds Quiet and Report before Remove from friends and Block. `talk-report` is the one
question it opens (a tap on a choice thanks you and sends nothing in a fixture) and
`talk-quieted` has Antti quiet: his Well played neither lands nor stays as the line.
`table-talk-face-tap` starts from `talk-coin`, taps your own face for your profile, then
Antti's, and quiets him from his sheet's •••.

Typing (PID-318) is `fixture=talk-type` (an adult's empty composer, faces and words above the box),
`talk-guest` (Want to type? Make a free account), `talk-teen` (nothing about typing),
`talk-typing` (the box, a draft in it, and who will not see it: Antti), `talk-typing-turn`
(your turn closed the box; the draft waits in the speech bubble) and `talk-filtered` (Send is refused:
Try other words, and the draft stays). Everyone but Antti reads typed talk in these fixtures.

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

Grammar cases `locale-{en,sv}-settings-{en,sv}` and
`locale-{en,sv}-{waiting,bidding,trump,hand-selection,game-over,dealer,playing}`
run at 390×844, 844×390, 667×375, plus localization-only additions to the
360×640 and 768×1024 shards. They reuse containment and 44px target checks
(including radios), assert the selection, English and Svenska side by side with no
System language, and non-persisted interactive switching, and reject clipped natural text without shrinking fonts. Long public
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
UI_CASES=locale-en-settings-en,locale-sv-settings-sv,locale-sv-bidding \
UI_SHOT_DIR=/tmp/pidro-locales node scripts/verify-ui-grammar.mjs
```

### `phase=` (default `playing`)

| Value              | Shows                                                              | testID                  |
| ------------------ | ------------------------------------------------------------------ | ----------------------- |
| `waiting`          | Shared new-table team list, 3 seated + 1 free                      | `waiting-table`         |
| `waiting-host`     | Host team list; tap a seat to invite or kick, no Manage/Lock panel | `waiting-table`         |
| `ready`            | Full table, ready-up flow                                          | `waiting-table`         |
| `ready-host`       | Full team list; occupied rows open kick confirmation               | `waiting-table`         |
| `ready-solo`       | You + three ready bots                                             | `waiting-table`         |
| `dealer_selection` | Skia table, dealer cut cards                                       | `seat-north`            |
| `playing`          | Skia table + trick overlay                                         | `seat-north`            |
| `bidding`          | Bidding window                                                     | `bidding-window`        |
| `declaring`        | You dealt: trump picker in felt                                    | `trump-picker`          |
| `second_deal`      | Dealer's private hand selection                                    | `hand-selection-window` |
| `game_over`        | Game over: win reveal or loss                                      | `game-over-window`      |

### Params

| Param        | Values                                                                                                    | Effect                                                                                                                                                                                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phase`      | see above                                                                                                 | which overlay                                                                                                                                                                                                                                                                                                              |
| `safeArea`   | `island` (59/34) · `android`/`android-buttons` (24/48) · `android-gesture` (24/24)                        | **fakes insets** — the one way to test notch clearance on web                                                                                                                                                                                                                                                              |
| `role`       | `player` · `spectator`                                                                                    | non-waiting phases: renders via the **real store/controller**, not the mock model                                                                                                                                                                                                                                          |
| `lifecycle`  | `normal` · `reconnecting` · `bot_substitute` · `permanent_bot` · `vacant`                                 | seat lifecycle badge state                                                                                                                                                                                                                                                                                                 |
| `feedback`   | `owner` (3 queued seat decisions) · `notice` (tap closes it) · `timed` (dedupe + success at 0.8/1.0/1.2s) | TableFeedback / TableSeatDecision; a notice stays at least `readingTimeMs` of its words                                                                                                                                                                                                                                    |
| `notice`     | `true`                                                                                                    | same as `feedback=notice`; on a waiting phase, a join notice below the toolbar                                                                                                                                                                                                                                             |
| `connection` | `lost`                                                                                                    | with `role=`: the channel is down, so the table shows its Reconnecting… banner                                                                                                                                                                                                                                             |
| `invite`     | `true`                                                                                                    | opens InviteModal (needs `phase=waiting-host`/`ready-host`)                                                                                                                                                                                                                                                                |
| `names`      | `long` · `max`                                                                                            | waiting: west seat → "Alexandria the Long-Named Player" (wrapping); table: Classic-length names on every seat (ThunderThor88 …); `max`: that 32-character name on every table seat; with `role=player` or a `fixture=`, `long` seats ironman3001 at West and Margaretha Lindqvist at North (PID-304)                       |
| `dealer`     | `north` · `east` · `south` · `west`                                                                       | table (mock model): who holds the dealer chip, default `south`                                                                                                                                                                                                                                                             |
| `timer`      | `running`                                                                                                 | table (mock model): a 20 s turn timer on the seat on turn; amber in its last quarter                                                                                                                                                                                                                                       |
| `signals`    | `pidro`, `pidro-theirs`, `points`, `points-theirs`                                                        | mock table, `autoplay=true`: `pidro` gold "Pidro!", "Us +6" in `teamUs`; `pidro-theirs` "Them +5 · Wynn" in `teamThem`; `points(-theirs)` a "+1" and the 2 of trump's in the team's colour                                                                                                                                 |
| `hand`       | `made` · `set` · `they-set`                                                                               | table (mock model): 1.6 s after the table opens the last hand is scored: the table dims under its result and the point cards each team took (PID-236). `made`: you made 8, stamped gold; `set`: you missed 10 by 3; `they-set`: Eli missed 9 by 3 and Nora took their Pidro. It closes by itself after 3 s (2 s for `set`) |
| `ticker`     | `full`                                                                                                    | table (mock model): the table opens with West's pass, and the other three bids land 0.3 s later, so the plaque's action ticker shows three lines; tap it for the hand log                                                                                                                                                  |
| `bids`       | `round` · `high` (with `phase=bidding&role=player`)                                                       | you and three bots; the bids land one by one. `round`: West passes, North bids 7, East goes to 9, then it is your turn. `high`: you hold the high bid at 9 and West is still to bid                                                                                                                                        |
| `out`        | `one` · `lone` (with `phase=playing&role=player`)                                                         | you and three bots, two tricks into hand 4 after Jocke bid 6. `one`: Marcel is out of trumps (dimmed, "Out", two cards folded face down). `lone`: the other three are out, and your seat says the rest is yours                                                                                                            |
| `trick`      | `bots` (with `phase=playing&role=player`)                                                                 | you and three bots, hearts trump: Wynn, Nora and Eli have played 9♥, K♥ and 4♥ to the first trick, and each seat says what it played; it is your turn                                                                                                                                                                      |
| `count`      | `on`                                                                                                      | turns on "Help me keep count": the plaque’s bid line reads "Jocke bid 6 · 2 of 6" (small phones too; a name with no room beside the bid takes a row of its own), "Last trick" sits under it, and the card winning the trick glows (mock table too)                                                                         |
| `playerName` | any string                                                                                                | name in the first seat decision                                                                                                                                                                                                                                                                                            |
| `viewer`     | `east`                                                                                                    | you are east instead of south                                                                                                                                                                                                                                                                                              |
| `rematch`    | `open` · `one` · `two` · `asked` · `waiting` · `in` · `missing` · `pending` (with `phase=game_over`)      | the rematch row, per seat: nobody asked / Nora has / Nora and Eli have / the other three wait on you / you asked first; `missing` has no vote yet, `pending` is sending yours                                                                                                                                              |
| `pass`       | `disabled`                                                                                                | removes the pass action from legal actions                                                                                                                                                                                                                                                                                 |
| `autoplay`   | `true`                                                                                                    | Skia table auto-plays (trick completion / card persistence)                                                                                                                                                                                                                                                                |

### Recipes

PID-268: `/table-dev?phase=playing&hand=own` holds the result without a timer;
a tap on the table, panel or **Tap to continue** releases this local fixture
(it does not send a channel intent). `hand=own-missed` shows a missed bid.
`menu=pace&solo=true` opens Pace for a bot table; omit `solo` for the human-table
Quick note. Add `locale=sv` for Swedish. Grammar cases `table-hand-own(-sv)`,
`table-pace-solo-en|sv`, `table-pace-human-en|sv` and `settings-pace-en|sv` cover
390×844, 375×667, 844×390 and 768×1024. The table windows fit without scrolling;
the existing full Settings page still scrolls to its account and update sections.

PID-304, small phones: every avatar keeps one meaning per corner (dealer D
bottom left, bot bottom right, winning bid top right at the bot badge's size,
nothing top left, where the turn ring sweeps). Tight phones put your avatar
under a centred hand and leave out the bid line and Last trick; with count
help the score panel's **This hand ›** opens the log. Marcel's TCL tables:
`/table-dev?fixture=details&names=long&dealer=west&bidder=east|north&count=on`,
and your turn `/table-dev?phase=playing&role=player&trick=bots&names=long&count=on`.
Grammar cases `table-small-west-deals`, `table-small-north-bid` and
`table-small-your-turn` run at 390×844, 360×780 (Android 24/48 insets),
360×640 and both landscapes, and fail when a seat (its badges included)
touches another seat, a played card or your hand.
`/table-dev?deal=hand` shows the dealer chip sliding from West to North.

PID-305, landscape phones: Classic's two rows per seat, one card size. Each
hand lies along its edge (North's backs whole along the top, yours along the
bottom), and each seat's front row lies inward of it: thrown cards land there
in the second deal, and its played card in a trick, so the trick is a cross.
No bid line or Last trick; with count help the score panel opens the log.
`names=long` seats ironman3001 dealing at West and Margaretha Lindqvist at
North in `deal=draw` and `deal=hand` too; `trick=full` (with
`phase=playing&role=player`) is the bots' trick with your A♥ on it;
`trick=third` is the third trick after two taken, `trick=seven` has East, who
kept seven trumps, put two cards into the first trick.

PID-307: the trick is Classic's cross around the trump mark, each played card
`TRICK_GAP` (12 dp) clear of the mark, your hand pushed down to the bottom edge
(rank and suit always showing), and the front rows hold only the current trick:
a finished trick clears after its hold. A seat's extra cards in one trick lie
along its axis (sides downward, North and you sideways). Grammar cases
`table-two-rows-{bidding,second-deal,dealer-throws,you-deal,kill,trick,third,seven,piles-5,hand-end}`
run at 844×390, 780×360 (Marcel's TCL) and 640×360, print every card's, seat
part's and the trump mark's rectangle in dp, and fail when any two are under
12 dp apart or anything but the hands leaves the screen. Every side card
points its top at the middle (PID-388): East's turned a quarter left, West's a
quarter right, so West's trail steps up its column and East's down.

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

| URL                                                                | Shows                                                                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/table-dev?phase=game_over&guest=true&crew=win`                   | A guest beat the bot crew: Marcel's JA36 game, 62–36 in 7 hands with Jocke, all 14 in hand 5. Winning trick, Every hand ›, Play real people |
| `/table-dev?phase=game_over&guest=true&crew=loss`                  | The same game lost (36–62): best hand, Every hand ›, Play real people                                                                       |
| `/table-dev?phase=game_over&xp=earned&rematch=one`                 | An account won with people: race chart with Every hand › in its header, streak and XP chips, the rematch row                                |
| `/table-dev?phase=game_over&result=loss&xp=earned&rematch=waiting` | An account lost with people and is waiting on a rematch                                                                                     |
| `/table-dev?phase=game_over&people=win&xp=earned&rematch=one`      | Won with people (Nora, Kalle, Mikko), 62–41 in 9 hands: the trick at 0.8×, the bid plaque, the chart, one XP chip, Nora's yes               |
| `/table-dev?phase=game_over&people=loss&xp=earned&rematch=in`      | Lost to Bengt and Nora after you said yes: best hand, Every hand ›, you first in the rematch row, Waiting…                                  |
| `/table-dev?phase=game_over&people=loss&xp=earned&rematch=one`     | The same loss before you answer; on 375×667 the eyebrow and XP chip give way                                                                |

`people=win|loss` seats people, and `rematch=in` has your partner and you agreed.
A loss shows its best hand and links to every hand instead of the chart.
`crew=win|loss` seats Jocke (partner), Marcel and Antti as permanent bots. With
three bots there is no rematch row; a guest sees no race chart; no game over shows
the rule set. `table-game-over`, `table-game-over-guest-win`,
`table-game-over-guest-loss`, `table-game-over-online-win`,
`table-game-over-online-loss-in` and `table-game-over-online-loss` check that, that
the top-level blocks never overlap, and that nothing leaves the screen, at
390×844, 375×667, 844×390, 667×375, 834×1194 and 1194×834.

The table's header is one row: the score plaque left, the menu right
(`TABLE_HEADER` in `TableChrome.tsx`). Portrait reserves it above the north seat;
landscape seats North inside it. Notices and the Reconnecting… banner share one
slot (`useTableReserves().noticeSlot`): floating at the bottom over your seat in
portrait, on the panel the old dock gave them, only while one shows (PID-393); the
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
five-size score/history/settings checks. Sound is the Settings tab's switch (same
saved setting); the haptics switch controls the native gameplay feedback.

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
`table-trick-stays` (PID-331) plays with `transition=0`, the server's Classic pace:
the finished trick's four cards stay still and opaque for 3 s, longer than a bot's
2 s beat, and the server-selected leader lights as the fourth card lands.

PID-302: `/table-dev?phase=bidding&role=player&fixture=dealer-late&late=1500` sends the
dealer cut with a 3 s window to a phone busy for `late` ms, then deals; grammar case
`table-dealer-late` checks the cut's winner is lit at least 300 ms before the deal.
`/table-dev?phase=bidding&role=player&loading=0.4` holds the quiet "Loading table…" bar a slow
phone shows until its cards are decoded (`table-loading`).

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

| URL                                                                                                                                                                              | Shows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/ui-dev?state=components`                                                                                                                                                       | Type scale, BevelButton (wood/glass × sm/md/lg/hero/icon, loading, disabled), Input wells, AuthProviderButtons, bevel swatches, legacy Button, DecisionWindow, friend rows, info cards and notices (`ui-friend-rows-panel`, `ui-friend-notices-panel`). testID `ui-foundation-panel`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/ui-dev?state=new-table&fixture=setup\|partner\|bots\|opened\|ready\|louisiana\|requirement\|password\|picker\|friends\|guest\|declined\|live-picker\|live-friends\|live-error\|characters\|bot-picker\|bot-picker-louisiana\|live-bots` | Shared setup/live team list. Setup testID `new-table-screen`; live (`opened`, `ready`, `guest`, `declined`, `live-*`) `waiting-table`. Rows `new-table-seat-north/south/east/west`; south is Partner, east/west opponents. `guest` is a nonhost, not an anonymous account. `declined` (PID-254): Maija said Not now, so south is open and the host sees "Can't come" (`seat-declined-notice`) at the top, in the footer on a small phone; Invite someone else opens the friend picker for south. `live-picker` opens the picker on the west password seat of an opened table, `live-friends` the friend list on south (Maija held); a fixture server applies each choice like `PUT /rooms/:code/seats/:position`. `live-error` fails Bot outright (the reason shows inside the picker) and answers any other choice with `SEAT_NOT_VACANT` after seating Eli there (the picker closes and the reason stays in the footer). PID-410: `characters` has Antti (East) and Gun (Partner) chosen and anyone West; `bot-picker` opens the bot page on Partner, `bot-picker-louisiana` on a Louisiana table with Celeste East; `live-bots` seats Gun West of an opened table, and the fixture server refuses Stig with `UNKNOWN_PERSONA`. A bot seat opens on its bot page (Anyone, Regulars, Also at the club); `‹ Other choices` leads to the rest. The fifteen characters are `BOT_CATALOGUE` in `features/lobby/fixtures.ts` (faces at `fixture.invalid` draw neutral). |
| `/ui-dev?state=new-table&fixture=talk\|talk-opened\|talk-full\|talk-typing\|talk-guest\|talk-teen\|talk-filtered` | PID-418, the waiting room's talk (testID `waiting-table`). `talk` is the boards' table: Kalle seated East (Ready), Maija invited as Partner, an open 100+ seat West, "Kalle sat down" and four lines. `talk-opened` is the table before anyone came, `talk-full` all four seated with Maija and Ville sitting down between the lines and I'm ready, `talk-typing` the field focused with a draft (phones fold the rows into `waiting-seat-strip`). `talk-guest` gets the faces and the account nudge, `talk-teen` the faces alone; `talk-filtered` refuses whatever is typed and keeps the draft and says why in `waiting-talk-refused`. PID-420: `talk-bots` has bots in the other three seats, so `waiting-talk-closed` says talk opens when a player sits down; opening a seat brings the field back. `talk-opened` shows the empty talk's `waiting-talk-hint`. The fixture server echoes faces (`talk-coin_*`) and typed lines (`waiting-talk-field`, `waiting-talk-send`) into `waiting-talk`; at `talk`, Kalle answers each typed line with a thumb 1.2 s later, so a line from someone else rises and rings his face. `/table-dev?phase=waiting*\|ready*` seat the viewer with an empty talk. |
| `/ui-dev?state=progression`                                                                                                                                                      | Progression HUD primitives: PlayerAvatar (sizes, no photo), RatingPlaque, LeagueProgress, CtaBadge. testID `ui-progression-panel`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/ui-dev?state=avatars`                                                                                                                                                          | PlayerAvatar: rings, pins, sizes 104–24, every seat state from the Seat-States board, label below/right/left. testID `ui-avatars-panel`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/ui-dev?state=seat-rows&fixture=setup\|setup-open\|opened\|opened-more`                                                                                                         | New table seat rows (PID-243): every state before and after the table opens, four seats at a time; landscape puts the teams side by side. testID `ui-seat-rows-panel`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

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
`new-table-live-picker`, `new-table-live-friends`, `new-table-characters`,
`new-table-bot-picker` and `new-table-bot-picker-louisiana`.

Waiting connection fixtures: `/ui-dev?state=new-table&fixture=reconnecting` keeps
Pedro1 seated with a quiet Reconnecting… row and Waiting for Pedro1… instead of
Ready. `fixture=ready` is the connected control. `fixture=ready-error` refuses a
ready tap with `table_not_full`; `ready-error-unknown` exercises the human fallback.
Add `&locale=sv` for Swedish. Grammar cases `new-table-reconnecting-en|sv`,
`new-table-ready-error-en|sv` and `new-table-ready-error-unknown-en|sv` check the
words, absent Ready action, and unclipped errors without scrolling at 390×844,
375×667, 844×390 and 768×1024 (also iPad landscape). Error testID `waiting-error`.

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

## `/profile?fixture=photo-<state>` — your photo and ring (PID-297, PID-395)

Use a signed-in account fixture. These development-only presentation states use
the real Profile and `BadgeSheet`; they do not open a native photo picker or upload
an image. The component supplies the fixture photo URI (`marcel.jpg`, so a photo is
never mistaken for a face), not the profile API.
The grammar mocks the same full profile as `profile-badges` (level 7, 28 new games,
and a Classic account with 1,862 games and level 14), so the ring and pin choices
are exercised beside the photo controls.

| URL                                 | Shows                                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `/profile?fixture=photo-profile`    | Profile, sheet closed; camera badge at the bottom-left inside the avatar                                    |
| `/profile?fixture=photo-empty`      | Sheet open, no photo; **Face 1** chosen, Photo a dashed camera circle                                       |
| `/profile?fixture=photo-face`       | No photo; **Face 2** chosen, and the big avatar wears it                                                    |
| `/profile?fixture=photo-face-saved` | Face 2 with **Saved. Everyone at the table sees it now.**                                                   |
| `/profile?fixture=photo-face-error` | Face 1 (snapped back) with **Could not change your picture. Try again.** and **Try again**                  |
| `/profile?fixture=photo-present`    | A photo on; **Photo** chosen and showing it, **Remove photo** under the row                                 |
| `/profile?fixture=photo-uploading`  | Photo chosen, labelled progress; the row is disabled and Remove photo waits                                 |
| `/profile?fixture=photo-saved`      | Photo chosen with **Photo saved** feedback                                                                  |
| `/profile?fixture=photo-error`      | The longest photo error (cannot open), and **Try again**                                                    |
| `/profile?fixture=photo-remove`     | Inline removal confirmation in place of the row; **Remove photo** is the one wood action, **Cancel** a link |

Signed-in avatar entry and sheet title: **Your photo and ring** / **Din bild och ring**.
Under the big avatar one radio row, **Your picture** / **Din bild**: **Face 1**,
**Face 2**, **Photo** / **Ansikte 1**, **Ansikte 2**, **Foto** (84pt discs, 64pt when
the window is under 700pt tall). The chosen disc has the gold rim, a gold check and a
gold caption. Under the row: **One tap and it is yours. Change it any time.** / **Ett
tryck så är den din. Byt när du vill.** That line yields to any line under the avatar,
and an error also hides the eyebrow and **Remove photo**, so every state fits a small
phone. Other owned copy: **Photo saved** / **Bilden är sparad**, **Saved. Everyone at
the table sees it now.** / **Sparat. Alla vid bordet ser det nu.**, **Could not change
your picture. Try again.** / **Kunde inte byta bilden. Försök igen.**, **Remove photo**
/ **Ta bort bilden**, and **Try again** / **Försök igen**. Profile is a normal route and ignores `locale=`:
select Swedish in Settings for manual previews. The grammar seeds the persisted
language preference for each photo case instead of changing the route's locale contract.

Grammar cases: `photo-profile-en`, `photo-empty-en`, `photo-present-en`,
`photo-uploading-en`, `photo-saved-en`, `photo-error-en`, `photo-remove-en`,
`photo-face-en`, `photo-face-saved-en`, `photo-face-error-en`, and `-sv` for
`profile`, `empty`, `present`, `error`, `face`, `face-saved` and `face-error`.
Controls `photo-profile-guest`, `photo-sheet-guest` and `photo-sheet-sv-guest` use
the existing guest auth fixture on `/profile`: no camera badge, and opening **Your
badges** / **Dina märken** shows the row with only the two faces (Face 1 chosen) and
no photo actions. All twenty-one cases run at 390×844, 375×667, 844×390 and 768×1024
via the explicit `photo` matrix flag. The existing `profile-badges` case opens the
renamed signed-in avatar entry.

Selectors: `profile-avatar-button`, `profile-camera-badge`, `badge-sheet`,
`photo-preview`, `photo-feedback`, `photo-actions`, `picture-choices` (a
radiogroup), `picture-face-a`, `picture-face-b`, `picture-photo`, `badge-options`,
`photo-remove`, `photo-retry`, `photo-confirm`, `photo-cancel`, `photo-progress` (a
labelled accessible progressbar), and `badge-done`. The only wood action is
`photo-confirm` while confirming removal. Remove and Retry are cyan links; Cancel
and Done are links. Checks enforce 44pt controls, viewport/sheet containment, no sheet scrolling
or clipped text, and no overlap between top-level sections. The camera stays
bounded in the avatar's bottom-left quadrant and is measured against both
`profile-avatar-pin` and `profile-avatar-level`. Profile itself retains its existing scrolling.

These browser fixtures do not certify native picker permissions/cancellation,
image cropping, actual upload/retry/removal, or native safe-area clearance.
`node scripts/verify-profile.mjs` exercises the real web file chooser and multipart
client against mocked HTTP, and the face tap through the real hook and API client
(older-server 404 and 503 snap back, Try again resends, a held PUT shows the face
first, the answer reaches Home, a face over a photo asks first, then DELETE and PUT): cancellation, unreadable/oversized images, automatic
upload and resizing, progress, two-second saved feedback, profile/Home session
updates, stale identity reads, failure/retry, and confirmed removal. It also checks
upload/removal completion after browser Back unmounts the sheet, plus the existing
bio, pin and Settings journeys. Native route removal is guarded while busy;
browser Back can still leave, but its server result updates the matching session.

## `/profile?fixture=legend` — your profile at a glance (PID-339)

Bengt from `Status-Profile`, with no server: Legend ★4 (prestige 4, 366,127 of 500,000
XP to the fifth star), Old Pidro since 2011 with 38,536 games, 40,612 games and 55% in
all, 18 friends with 2 on, and four of fourteen medals earned. Grammar case
`profile-legend` checks the board's copy, the shelf order (earned first, then locked),
**All 14 ›**, touch targets, and that **Blocked players** in the Account row opens
Blocked players, at 390×844, 375×667, 844×390 and 768×1024.

## Shell friend notices

PID-276: `/home?fixture=waiting` puts three incoming requests on both the avatar
and Friends tab. `/home?fixture=invitations` also shows the avatar's seat count,
including with guest auth (no tab). `/profile?fixture=list|empty` shows the friends
cell of the stat strip (`profile-friends-cell`, PID-339) with six friends, three of them
on, or zero; tapping it opens Friends with Back to Profile.
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

## Startup updates (PID-362)

`/ui-dev?state=updating&fixture=downloaded&locale=en|sv` holds the real startup screen
at 60% progress. `fixture=applying` runs a three-second visual download, then routes
to Home as a stand-in for native reload. Use an authenticated fixture for that demo.
It does not call EAS: Expo web and Expo Go cannot apply native updates.

`startup-update-en|sv` checks the copy, progress accessibility value and containment
without scrolling at 390×844, 375×667, 844×390 and 768×1024:

```sh
UI_CASES=startup-update-en,startup-update-sv \
UI_VIEWPORTS=portrait,small-portrait,landscape,tablet-portrait bun run test:ui
```

The root mounts routes only after the startup gate releases. Checking and fetching
share five seconds; late downloads wait for the next cold start. A newly launched
cached bundle skips the network gate. Before reload is committed, backgrounding ends
the gate permanently for that launch; foreground never reloads. Once committed, the
gate stays closed until native replaces the runtime or reports failure, since a
native reload cannot be cancelled. Settings retains manual check/download/apply,
but cannot apply while attached to a game. Native EAS delivery and rollback still
need an installed release build; browser fixtures do not certify them.

## Retired shell update notices

`store-update-notice-{home,settings}-{en,sv}` now asserts that no native-update
banner appears. PID-363 uses the startup News card instead, including the lobby
minimum-version fallback. The retired `update-notice`, `update-notice-friends-guest`
and `update-notice-home-guest` cases similarly assert no OTA notice appears.

Every Home case (including 667×375 for `home`, `home-guest` and the notice cases)
hit-tests the header's controls and both play tiles: each must take its own taps. In
landscape a guest's column (tiles, Classic plaque, Sign in) is taller than the space
beside the logo once there are insets, so it scrolls there instead of covering the header.

## `/auth-flow-dev` — guest-first auth

Accepts the bounded locale parameters above. Includes gates that open `AuthSheet` (`multiplayer`, `friends`, invite link)
and the post-game `KeepProgressPrompt`. Deliberately outside the auth guard. testID
`auth-flow-dev`.

## `/claim-classic?fixture=<state>` — Classic claim

The real claim screen with deterministic presentation states and no backend mutation. States:
`method` shows the three sign-in choices; `login` shows only Classic credentials;
`login-wrong-twice` is the same step after two wrong passwords for ThunderThor88 (PID-312):
the offer to email a code sits above the password field (in the side column in landscape,
taking the heading's room on a phone), with "Email me a code" opening Classic forgot;
`preview` asks "Is this you?" with the Classic name and games/level/since;
`social` is the same card after a Facebook verification that offers the Classic
username (PID-301): signed out, "Yes, that's me" claims without a details step
(grammar case `classic-social`; `classic-fresh` is its password control, which opens one);
`password` asks for a new password, keeping ThunderThor88 and the Classic email;
`rename` puts the replacement public name on the details step.

`password-reused` and `password-short` show Petter (level 100) after an accepted
Classic password (PID-361). Both say the old password was right. Reused has no
password field and says to keep using it; short explains the 8-character rule and
that the account and points stay. The old `password` fixture is the emailed-code
control: no old password to reuse. Grammar cases `classic-password-{reused,short}-{en,sv}`
check the copy, input count, touch targets and no clipping or scrolling at
390×844, 375×667, 844×390 and 768×1024. For example,
`/ui-dev?state=claim-classic&fixture=password-reused&locale=sv`.

`already-claimed` (password owner, verified as ThunderThor88, a guest with 12 games) and
`already-claimed-apple` (Apple owner, a guest with no games) say "Already in Pidro" over
the Classic card, with one line on how the owner signs in. Signed out or a guest, the one
wood action is "Sign in", which replaces this screen with Sign in, the verified Classic
login filled in; a guest who played is told their guest games won't come along. A saved
account gets "You're signed in as Bengt. Sign out first…" and no wood action. Under the
window: "Forgot password?" (password owners, prefilled the same way) and "Back".
PID-293 grammar cases: `classic-conflict-fresh` (nobody, password), `classic-conflict-guest`
(guest with games, password), `classic-conflict-guest-apple` (guest, Apple) and
`classic-conflict` (saved account), plus Swedish `locale-sv-classic-already-claimed`.
They check the lines, the links, exactly one wood "Sign in" (none for the saved account)
and that no text, link or button overlaps another.
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

### PID-298 — account wording matrix

The route and case identifiers above stay unchanged; player-facing copy says Pidro,
not Classic or claim. The first plaque reads “Already play Pidro?” / “Spelar du redan
Pidro?”, the welcome note names the old Pidro app, and the profile pill and pin say
“Old Pidro” / “Gamla Pidro”. Direct account routes use the case's `locale` as a saved
Settings preference; `/ui-dev` keeps its existing locale fixture behavior.

Reuse the existing claim cases, welcome-note cases and photo/badge fixtures. Only
the missing Swedish first screen/profile and recovery states are added. Run from
`packages/mobile` against the existing Expo web service:

```sh
export UI_VIEWPORTS=portrait,small-portrait,landscape,tablet-portrait
export UI_CASES=photo-profile-en,photo-empty-en,photo-profile-sv,photo-present-sv,news-welcome-en,news-welcome-sv,welcome,welcome-sv,classic-method,classic-preview,classic-guest,classic-fresh,classic-rename,classic-conflict,classic-conflict-fresh,classic-conflict-guest,classic-conflict-guest-apple,classic-login,classic-login-wrong-twice,classic-password,classic-password-guest,locale-sv-classic-method,locale-sv-classic-login,locale-sv-classic-login-wrong-twice,locale-sv-classic-preview,locale-sv-classic-password,locale-sv-classic-rename,locale-sv-classic-already-claimed,classic-rename-fresh,classic-details-en,classic-rename-details-en,classic-taken-en,classic-details-sv,classic-rename-details-sv,classic-taken-sv,classic-forgot,classic-code,classic-code-invalid,classic-help,classic-not-found-en,classic-unavailable-en,classic-help-sent-en,classic-forgot-sv,classic-code-sv,classic-code-invalid-sv,classic-not-found-sv,classic-unavailable-sv,classic-help-sv,classic-help-sent-sv,forgot-password,forgot-password-sv
node scripts/verify-ui-grammar.mjs --list
node scripts/verify-ui-grammar.mjs
```

This is exactly 196 matrix IDs: each of the 49 `UI_CASES` above prefixed with
`portrait/` (390×844), `small-portrait/` (375×667), `landscape/` (844×390), or
`tablet-portrait/` (768×1024). No duplicate case is needed for an already covered
English step. `photo-empty-en` and `photo-present-sv` cover the badges as well as
the photo controls; `photo-profile-en|sv` cover the profile pill. `forgot-password`
and `forgot-password-sv` cover recovery from Already in Pidro and its link back to
the old-app account flow.

Account surfaces assert no scrolling and no clipped text/control boxes, including
clipping by ancestors. The full Profile intentionally scrolls: only its pill gets
the containment check, after scrolling it into view. The first screen's no-scroll
check covers the four sizes above. Its pending-invitation variant and other sizes
keep their existing scroll behavior; the translated plaque must fit in the viewport
without scrolling it into view. Existing touch-target, claim
CTA, already-owned-account and photo-sheet checks remain in force. These assertions
do not waive overflow on small screens; a failing fit needs copy/layout work, not a
larger viewport or a hidden test. Native safe-area/keyboard fit still needs a device.

## `/age?fixture=<state>` — age gate

`unanswered` (no range chosen, Continue disabled), `selected` (18 or older chosen,
Continue enabled), `under13` (the stop screen). testID `age-screen`, or
`age-stop-screen` for `under13`.

PID-296: Age and `/ui-dev?state=welcome&locale=en|sv` share the English/Svenska
radio switch. On Age it writes the real Settings preference; the gallery keeps
its language ephemeral. `age`, `age-selected`, `age-sv`, `age-stop`, `age-stop-sv`
and `news-welcome-en|sv|home` check 390×844, 375×667, 360×640, 844×390 and 768×1024:
no scrolling/overlap, 44pt targets, Marcel's loaded photo and one wood welcome CTA.
`e2e/specs/settings-language.spec.ts` checks switching on both real screens,
keyboard focus and the preference surviving reload into Settings. These browser
checks do not reproduce the iOS native splash lifecycle.

## `/home?fixture=tell-<state>` and `/settings?fixture=tell-<state>` — Tell us (PID-316)

The Tell us sheet open in one state, or the question card on Home. The fixture sets
only where it starts; Send, the answers and the next question go to the server
(`POST /api/v1/feedback`, `GET /api/v1/feedback/ask`), which the UI-grammar cases route.

| `state`   | Shows                                                                     |
| --------- | ------------------------------------------------------------------------- |
| `open`    | Sheet, empty card, the reply line or "Want an answer?", Send off          |
| `typing`  | Sheet with words on the card, Send on                                     |
| `chip`    | Sheet opened from the question card: "About your last game" on the card   |
| `sent`    | "Thanks. We read every one." and Done                                     |
| `failed`  | Words back on the card, the alert, Try again and "Use my mail app"        |
| `limit`   | The limit alert and a disabled "Send tomorrow"                            |
| `account` | A guest the server turned away (403): "Create a free account to tell us." |
| `guest`   | The email field folded down with an address typed (an account, no email)  |
| `pace`    | Home's question card: Pace in your last game                              |
| `old`     | Home's question card: Compared to the old Pidro                           |

testIDs `feedback-sheet`, `feedback-body`, `feedback-email`, `feedback-send`,
`feedback-ask`, `news-tell`, `settings-tell`. On Home, Tell us is the first row in
News (PID-347). UI grammar: the `tell-*` cases at
390×844, 375×667, 844×390 and 768×1024 (`tell-keyboard` takes the keyboard's height
off each), Swedish at 390×844; `TELL_FRAMES_DIR=<dir>` saves the send frame by frame.

## `/home?fixture=news-<state>` — News and who is online (PID-347)

Home's News door and the Friends tab's count, or the News sheet open. The posts come
from the fixture, not `GET /api/v1/news`, and opening sends no Seen; Write back posts
to `POST /api/v1/feedback` with `news_post_id`, which the UI-grammar cases route.

| `state`   | Shows                                                                  |
| --------- | ---------------------------------------------------------------------- |
| `home`    | The door with its dot (two new posts), the tab's green count: 2 online |
| `request` | A friend request and nothing new: the tab's red 1 wins over 2 online   |
| `sheet`   | News open: Tell us, then three posts, the two new ones with a dot; the |
|           | newest with the Pidro artwork as its image, the oldest's image fails   |
| `reply`   | Write back open over News on the sounds post, its title on the chip    |
| `empty`   | News open with only the Tell us row                                    |
| `error`   | News open: Tell us, "News didn't load." and Try again                  |

testIDs `home-news`, `home-news-dot`, `news-sheet`, `news-feed`, `news-tell`,
`news-post`, `news-post-new`, `friends-online-count`. A guest reads News without Tell us
or Write back, and has no Tell us in Settings either (PID-348): `news-sheet-guest` and
`settings-feedback-guest-en|sv`.
UI grammar: the `news-*` cases at 390×844, 375×667, 844×390 and 768×1024. The talk button with talk on and off is on
`/ui-dev?state=components` (`ui-doors`).

## `/home?fixture=popup-<state>` — startup News (PID-363)

`update` is the Android update board without an image; `image` adds an image;
`news` is the plain-news board with an image and no eyebrow or Later; `ios` uses
the iPhone button (TestFlight in the beta variant, App Store in production); `link`
is plain news with a custom linked button. Update cards name both builds under the
body, "You have build 14 · this is build 19" (fixture numbers; web has no build). These
render the real centered card over Home. The bundled Pidro artwork stands in for
the editor's image. Images retain their whole contents; in phone landscape the
image sits beside the copy so the text and actions keep their size.

Grammar cases `popup-{update,image,news,ios,link}-{en,sv}` run at 390×844,
375×667, 844×390 and 768×1024. The grammar seeds Settings language (Home does not
read `locale=`). It checks loaded images, bold text, centered containment, no
clipping/scrolling, 44pt controls, button URLs, dismissal and the absence of the
old update notice. Fixtures never send Seen, and their links use `example.invalid`.
For longer editorial copy or large accessibility text, the copy alone may scroll;
the card stays inside the safe area and its actions remain reachable.
testIDs: `news-popup`, `news-popup-body`, `news-popup-image`, `news-popup-action`,
`news-popup-later`.

Live posts come from the first News answer at startup, after the root OTA gate
and Marcel's welcome. They wait for Home and never show over a game or another
Home sheet. Close or a successful button link acknowledges that post; Later and
Android Back on an update only suppress it for this cold start. A failed Seen
keeps the card available to retry. Feed Seen remains separate. The lobby's
`native_update_popup` prevents its minimum-version fallback from resurrecting an
acknowledged post; false/absent keeps legacy minimums and platform URLs working.
Browser captures do not certify native insets, system font scaling, the OS link
handoff, or Expo's release-only startup update lifecycle.

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
See full profile opens the player sheet (PID-340): Friends instead of Add, and
Block behind its "…". `sheet-partner`, `sheet-opponent`, `sheet-full`,
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

`link-profile` opens Nora's player sheet as her own link (`/play/<slug>`) opens it
for a signed-in player who is not her friend yet: Add, then Sent, without the backend.
Grammar case `friends-link-profile` covers 390×844, 375×667, 844×390 and 768×1024.

## `/blocked-players?fixture=<state>`

Authenticated fixtures: `empty`, `filled`, `loading`, `error`. The filled list
has no presence labels; Unblock is inert in fixtures. Grammar cases are
`blocked-empty`, `blocked-filled`, `blocked-loading`, and `blocked-error`.
`friends-block` opens the confirmation from the short friend sheet. The
`block-profile-playing` and `block-profile-game_over`
cases open a human's player sheet through `/table-dev?phase=<phase>&role=player`,
mocking only the profile response, and reach Block through the sheet's "…".
`block-profile-guest` checks that guests see no "…" and read that a free account
is needed.

`/table-dev?fixture=status&role=player&seats=a|b` (PID-338) seats the six players
of `Status-Seats` over the four seats: Bengt ★4 deals, Aino holds the bid at 9; in
`b` Antti is a bot and Jussi reconnecting. `&cut=true` shows the dealer cut, where
the level chips show. Grammar cases `table-status-a|b` and `-cut` measure them on
every table layout.
`/table-dev?fixture=status&role=player&seats=a&sheet=kalle` opens Kalle's player
sheet over the `Status-Seats` table (`player-sheet-kalle`, every table layout): seven
medals, a talk table's •••. `&relation=asked|sent|friends` says where you two stand
(PID-406; none without it); Accept on `asked` shows You're friends now, and a guest
sign-in shows the guest line. `lobby-player-sheet` taps a seated player in a lobby row.
The old waiting profile-entry case is retired: occupied new-table rows open kick
confirmation, not a profile.

## Rule-set fixtures

Development-only, no backend needed (except the real manual-code path, mocked by
the grammar script). Invite routes
show a guest name-entry preview without auth, or the same table's confirmation
with an authenticated fixture.

| URL                                                            | Shows                                                            |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `/ui-dev?state=new-table&fixture=setup` / `fixture=louisiana`  | Selected setup rule radios                                       |
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

Choose cases and widths by the [testing and proof contract](../../../docs/testing.md).
During iteration run the affected selection, not the full inventory. Freeze Metro's
source tree while capturing. These are browser checks, not native iOS evidence.

Needs Expo web running (`bun run web`) and, once per machine,
`bunx playwright install chromium`.

```bash
UI_CASES=table-bidding,home UI_VIEWPORTS=portrait bun run test:ui  # focused feature proof
UI_CASES=table-bidding UI_VIEWPORTS=portrait,landscape bun run test:ui  # clearance risk
# Release/manual only: bun run test:ui (full viewport matrix, targets, containment)
UI_CASES=home UI_VIEWPORTS=portrait UI_SHOT_DIR=/tmp/shots bun run test:ui
UI_PARTITION=1/15 UI_REPORT_PATH=/tmp/ui-report.json bun run test:ui  # one CI-sized batch
node scripts/verify-ui-grammar.mjs --list        # selected viewport/case IDs, no browser
node scripts/verify-ui-grammar.mjs --list-cases  # every case's name and route, no browser
node scripts/ci-affected.mjs <base-sha>          # what CI would run for the changes since base
MOBILE_BASE_URL=http://localhost:8081 node scripts/verify-seat-decisions.mjs
node scripts/verify-waiting-seats.mjs   # 4 target sizes; shared list, readiness, kick and live choices
node scripts/verify-profile.mjs
node scripts/verify-dealing.mjs  # four dealers, 3/6/9 receive order, sort/bidding timing, reconnect, reduced motion
```

`bun run test:ui:diff` (pixel diff) is **CI-only** — baselines are Linux Chromium
renders, so Mac captures flag font/antialiasing noise. On a push to `main`, CI adopts
the drift on the screens the changes since the last green `main` draw (the areas of
`scripts/ci-affected.mjs`): it commits their new captures, and the first capture of a
new case, on top of the pushed commit, links them in the "UI grammar" summary and goes
green. Drift on other captured screens fails; shared/unknown changes (tokens,
primitives, CI) and full release runs auto-adopt nothing. Inspect intended drift
before accepting the corresponding captures with `bun run ui:baselines <runId>`.

A push runs representative affected cases + table/lobby/home/login smoke
(`scripts/ci-affected.mjs`, reasons in "Select checks"): at most 16 cases, portrait
only, plus landscape for layout risk. It runs affected unit tests, **not full
game/account journeys or multi-size behavioral suites**. The manual release test
(Actions → Frontend CI → Run workflow, `full=true`) retains all cases/viewports,
behavioral suites, unit tests and game/account journeys. Uncaptured viewport baselines
remain unchanged; release owners must inspect/reconcile intended drift there. Do not
bulk-adopt unexplained drift or treat auto-adoption as visual review.
CI balances the release matrix across up to fifteen jobs, about forty screens each,
using Linux case durations in `scripts/ui-case-costs.json` (last calibration: the mean
of Actions runs `41814859939`, `41812350012`, `41826874604` and `41830244863`).
New cases use the median recorded duration and are still included.
Refresh the weights from a successful run's `ui-report-*`
artifacts (each record's `id` maps to its `ms`); local Mac timings are not comparable.
The aggregate checks that every selected case completed exactly once and its
capture exists, then compares the captured screens against their baselines; a
full run requires every baseline to have a capture. Its job summary lists the slowest
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

## Weekly leagues (PID-353)

`/league?fixture=league-<state>` renders contract-shaped data without league reads or
mutations. States: `placed` (Bengt, 6th with 1,240), `27` (own row pinned),
`deuce`, `pidro`, `small` (four players, one promoted and one demoted), `not_placed`,
`opted_out`, `guest`, and `off`. Home and Profile accept the same fixture prefix
for their league card/cells. Card names are visible only in the optional rules,
never on standings, Home, Profile, friends or results. No room/tier wording remains.
All five cards use hearts, in order **2♥, 10♥, J♥, A♥, 5♥** (including dividers,
Home, Profile, rules, contextual chips and postgame).

Grammar cases `league-<state>-en|sv`, `league-home-<status>` and `league-profile`
run at 390×844, 375×667, 844×390 and 768×1024. Both dividers are inside the
standings: `league-up-divider` AFTER the server's last promoted row and
`league-down-divider` BEFORE its first demoted row. They say **↑ Move up** /
**↓ Move down** (**↑ Flytta upp** / **↓ Flytta ner**) beside a card. Geometry
checks cover both adjacent rows and the pinned footer, including absent bands at
the lowest/highest card. There is no demotion footer. The shell does not scroll;
the standings do. Avatar rows use today's ring and level chip.

There is never an intro, including for the untouched backend samples. Tap
`league-info` on `/league?fixture=league-placed` for `league-rules`;
`league-rules-close` dismisses it. `league-rules-en|sv` replaces the old intro
cases and checks exactly five bare card names and four paragraphs, clipped text,
44pt controls and viewport containment. English names: Deuce, Ten, Jack, Ace,
Pidro; Swedish: Tvåa, Tia, Knekt, Ess, Pidro. English paragraphs:

1. Every game you play with other people earns points. Games with only bots don’t count.
2. Each week you’re up against about 30 players at your level.
3. On Sunday evening the top players move up a card and the bottom ones move down.
4. Your best card each month shows on your profile.

The Swedish case locks the four corresponding paragraphs from the shared league
translations as well. Rules are opt-in only, not a gate based on a seen flag.

For board comparison captures, use `UI_DEVICE_SCALE=2 UI_TIMEZONE=Europe/Helsinki`.
These options only change the browser, never the client's date rules. As elsewhere,
the route ignores `locale=`; grammar seeds the persisted Settings language instead.
Browser checks do not certify native safe areas or maximum system text scaling.

`league-pin-scroll-en|sv` checks a 27th-place row entering and leaving the list,
then a height-starved resize and restore. Reclaiming its footer can make an entering
row fully visible; only that full-visibility state may unpin. Placed cases explicitly
scroll the sixth-place row partly above (still pinned), then fully above the list.
`league-pin-first-partial-en|sv` runs in landscape: a grammar-only init hook sets
an initial restored scroll offset so the sixth-place row is partly above the list before
test interactions, then verifies the pin and full-visibility unpin. The stable
outer allocation and height guard remain: height-starved lists never oscillate.
Pinned rows occupy a separate footer slot; real boxes must show no overlap with
standings or either divider. Partial **or** fully offscreen rows pin in either direction.

`/profile?fixture=league-profile` deliberately supplies 2,700 league points against
1,240 profile-week XP: placed Profile uses the former. The
`league-profile-not-placed` case keeps the latter. Both capture the weekly cell
scrolled clear of the navigation pill. Home and Profile show a card plus **6th this
week** / **6:e den här veckan**. Not placed says **Play a game with people to get
on the board** / **Spela ett parti med andra för att komma med på listan**.
Swedish cases are `league-home-placed-sv`, `league-home-not_placed-sv`,
`league-profile-sv`, and `league-profile-not-placed-sv`. The extra monthly ribbon
sentence is absent from Profile; the actual ribbon shelf remains.

`league-result-up`, `league-result-stayed`, and `league-result-down` on Home preview
the pending result. Only up/down render a sheet: two cards, **You moved up!** or
**You moved down**, **5th of 30** or **27th of 30**, and **Continue**. Swedish uses
**Du flyttade upp!** / **Du flyttade ner**, **5:e av 30** / **27:e av 30**, and
**Fortsätt**. `league-result-continue` remains the action selector and goes straight
to standings; `league-result-backdrop` dismisses without navigating. There is no
Close action, date, result ribbon, star or next-week promise. Fixtures acknowledge
locally; real accounts POST the result ID before dismissal. A result never
interrupts a screen pushed above the shell.

`league-result-stayed-en|sv` checks no modal/backdrop ever flashes, while
`league-result-stayed-host-en|sv` drives real `LeagueHost` on `/home` with a routed
pending-stayed response and checks its silent POST acknowledgement. Obsolete
intro/first-reveal and earned-star result cases are retired, not duplicated.

`/profile?fixture=league-ribbons` shows twelve monthly ribbons; tap the row to see
the same twelve with full month names. The current ribbon is faded. Stars and
star eligibility come from the server, not participation inferred on the client.
Grammar cases `league-result-<move>-en|sv` and `league-ribbons-shelf|expanded-en|sv`
measure the sheets at all four league sizes. The Profile itself retains its
existing scrolling layout; only the expanded ribbon sheet must fit without scrolling.

`/league?fixture=league-friends` and `league-friends-not_placed` add Mirja (Ace,
third) and Kalle (Ten, twelfth). The strip title is **Friends this week** /
**Vänner den här veckan**. Its rows show names, cards and points, never ordinals:
Mirja 3,120, your highlighted Bengt row 1,240, Kalle 900, sorted by points. The
not-placed fixture has only the two friends, not a fabricated own standing. Tap a
friend row for the existing FriendSheet; own rows are not friends. Mirja and Kalle
also have standings marks `league-friend-mark-${row.user_id}`. Grammar
cases `league-friends|friends-not_placed|friends-sheet-en|sv` cover all four sizes;
empty friend sections stay absent. `league-friends-pin-en|sv` uses the same friends
fixture at all four sizes: the pin hides while your friends row is fully visible,
returns for a partial row, then hides again when the row is fully visible. It also
checks scrolling away and back to the end of the list. `league-player-sheet-en|sv` taps Mirja's first
standings row and checks the contextual `player-sheet-league` chip: card plus
**1st this week** / **1:a den här veckan**, with no rendered card name.

`/settings?fixture=league-placed` previews the registered player's switch and its
midweek confirmation; `league-opted_out` previews it on. Grammar cases
`league-settings-visible|hidden|confirm|failed|guest|off-en|sv` use the real API
client with routed raw responses. They exercise cancel, hide, show, retained state
after a failed PUT, guest/off suppression, and confirmation containment at all
four sizes. Settings keeps its existing scrolling layout.

`/league?fixture=league-sample-<name>` consumes the eight unchanged backend samples
in `src/features/leagueSamples/`: `placed`, `not_placed`, `opted_out`, `guest`,
`off`, `pending_up`, `pending_stayed`, `pending_down`. Source: backend `main`
commit `9a61abcb1b1f1ed65624f58e7c0c1527dcd4fb21`,
`apps/pidro_server/priv/league_samples/`. The board fixture starts from the published
placed response, overriding its presentation data for the exact board comparison.
The `league-sample-*` grammar cases dismiss only up/down results before measuring
the supplied standings and both server bands. Stayed is invisible; no intro is
acknowledged. League grammar cases isolate unrelated HTTP calls so fake fixture
tokens cannot sign themselves out against a running real backend.

### Round4 postgame and Home movement

Use `/table-dev?phase=game_over&people=win&xp=earned&rematch=one&leagueChange=<change>`.
`leagueChange=up|down|same|new|delayed|off|opted_out|guest` supplies the real
GameOverOverlay `leagueProgress` prop, not a second league overlay. Expected copy:

| Change    | English                              | Swedish (`locale=sv`)                     |
| --------- | ------------------------------------ | ----------------------------------------- |
| `up`      | +20 · 5th this week ↑                | +20 · 5:e den här veckan ↑                |
| `down`    | +20 · 7th this week ↓                | +20 · 7:e den här veckan ↓                |
| `same`    | +20 · 6th this week                  | +20 · 6:e den här veckan                  |
| `new`     | You're on the board · 12th this week | Du är med på listan · 12:e den här veckan |
| `delayed` | the `up` line after 1,000ms          | the `up` line after 1,000ms               |

Human seated viewers retain `game-over-league-slot` even without eligible progress;
only the eligible line has `game-over-league`. Off, opted-out (hidden), guest and
solo/bot-crew games show no league line. Guest viewers (`guest=true`) and solo
crew viewers (`crew=win`, without `people=win`) do not reserve the human slot.
`league-game-<change>-en|sv` checks the line, card, one-line unclipped copy,
non-overlap, rematch seats and buttons. The additional `solo` case is an account
against the crew; `crew` is a guest against the crew. Delayed cases use reduced
motion and sample actual button boxes from first render, before generic animation
readiness waits can consume the delay; boxes must stay within 1px before/after.

`league-game-up-island`, `league-game-up-island-left`,
`league-game-up-island-right` and `league-game-up-android-gesture` add synthetic
native-sized inset containment checks at the four browser sizes. These are browser
approximations, **not native proof**. Omit `safeArea` for real-device checks.

`/home?fixture=league-home-tick-up` places Bengt fifth with 1,260 points;
`league-home-tick-down` places him seventh. The grammar preloads AsyncStorage's
web backing store (localStorage, **no prefix**) once per page session:

```json
{ "week": "2026-11-01T19:00:00Z", "league": "jack", "place": 6 }
```

Key: `league-home:v1:ui-grammar-user`. Cases
`league-home-tick-{up,down}-{en,sv}` sample the Animated.View
`home-league-tick` from first render, proving old sixth → new place and motion.
Their `-reduced` counterparts prove no animation. Each saves an extra
`-first-change.png` capture with the arrow before reloading; the ordinary capture
then proves reload has neither another arrow nor repeated animation.

### Marcel Round4 proof captures

After the UI migration settles, run from `packages/mobile` against Expo web.
Four-size English proof (390×844, 375×667, 844×390, 768×1024):

```sh
UI_DEVICE_SCALE=2 UI_TIMEZONE=Europe/Helsinki \
UI_VIEWPORTS=portrait,small-portrait,landscape,tablet-portrait \
UI_CASES=league-placed-en,league-27-en,league-small-en,league-deuce-en,league-pidro-en,league-not_placed-en,league-rules-en,league-result-up-en,league-result-down-en,league-result-stayed-en,league-result-stayed-host-en,league-home-placed,league-home-not_placed,league-profile,league-profile-not-placed,league-player-sheet-en,league-friends-en,league-pin-scroll-en \
node scripts/verify-ui-grammar.mjs
```

Phone Swedish proof (390×844):

```sh
UI_DEVICE_SCALE=2 UI_TIMEZONE=Europe/Helsinki UI_VIEWPORTS=portrait \
UI_CASES=league-placed-sv,league-27-sv,league-small-sv,league-deuce-sv,league-pidro-sv,league-not_placed-sv,league-rules-sv,league-result-up-sv,league-result-down-sv,league-result-stayed-sv,league-result-stayed-host-sv,league-home-placed-sv,league-home-not_placed-sv,league-profile-sv,league-profile-not-placed-sv,league-player-sheet-sv,league-friends-sv,league-pin-scroll-sv \
node scripts/verify-ui-grammar.mjs
```

Add `--list` to either command to check selected capture IDs without a browser.

Round4 additions, all four sizes (first-partial cases select landscape only):

```sh
UI_DEVICE_SCALE=2 UI_TIMEZONE=Europe/Helsinki \
UI_VIEWPORTS=portrait,small-portrait,landscape,tablet-portrait \
UI_CASES=league-friends-en,league-friends-sv,league-friends-not_placed-en,league-friends-not_placed-sv,league-friends-sheet-en,league-friends-sheet-sv,league-pin-scroll-en,league-pin-scroll-sv,league-pin-first-partial-en,league-pin-first-partial-sv,league-game-up-en,league-game-up-sv,league-game-down-en,league-game-down-sv,league-game-same-en,league-game-same-sv,league-game-new-en,league-game-new-sv,league-game-delayed-en,league-game-delayed-sv,league-game-off-en,league-game-off-sv,league-game-opted_out-en,league-game-opted_out-sv,league-game-guest-en,league-game-guest-sv,league-game-solo-en,league-game-solo-sv,league-game-crew-en,league-game-crew-sv,league-game-up-island,league-game-up-island-left,league-game-up-island-right,league-game-up-android-gesture,league-home-tick-up-en,league-home-tick-up-en-reduced,league-home-tick-down-en,league-home-tick-down-en-reduced,league-home-tick-up-sv,league-home-tick-up-sv-reduced,league-home-tick-down-sv,league-home-tick-down-sv-reduced \
node scripts/verify-ui-grammar.mjs
```

## `/ui-dev?state=settings` — Show a test ad (PID-390)

Development builds (`__DEV__` or variant `development`) show **Show a test ad** under
Settings → About the app. On a phone it runs the rewarded-ad path with Google's test
unit and prints `earned`, `dismissed` or `unavailable` plus the error. Expo web shows
"Ads need a phone" and no button. Grammar case `settings-test-ad` asserts that
state at all four sizes. The ad itself needs a development build on a device: see
`../../docs/native-sdks.md`.

```sh
UI_CASES=settings-test-ad UI_VIEWPORTS=portrait,small-portrait,landscape,tablet-portrait \
  MOBILE_BASE_URL=http://localhost:8081 bun run test:ui
```

## `/ui-dev?state=settings&fixture=premium-<state>` — Premium (PID-124)

Settings → Premium sits between Account and About the app, and only for a player the
server says has Premium (`premium`, `premium_until`, `premium_source` on the session
user). A player it says has none sees no panel, only a quiet **Restore purchases** link
at the very bottom, under About the app, where the store is available; before the
server has said, neither shows. The fixture swaps in a made-up answer and shows the
phone's screen on Expo web, where the real panel only says "Premium is managed in the
Pidro app on your phone." The fixture's Restore purchases never reaches RevenueCat.

| `fixture=`          | Premium panel               | Restore purchases            | Manage subscription  |
| ------------------- | --------------------------- | ---------------------------- | -------------------- |
| `premium-none`      | none                        | link at the bottom, ready    | none                 |
| `premium-until`     | Premium until 12 March 2027 | button in the panel, ready   | shown (store)        |
| `premium-lifetime`  | Lifetime Premium            | button in the panel, ready   | hidden (promotional) |
| `premium-restoring` | none                        | link at the bottom, disabled | none                 |

Grammar cases `settings-premium-{none,until,lifetime,restoring,web}-{en,sv}` assert the
words, that Restore is disabled only while it runs, Manage only for a store purchase,
44px targets, the whole panel on screen, and for a free player no panel and the link
last on the screen, at all four sizes. The `web` case is the real screen signed in
with Premium. The restore itself, the toast and the store's sheet need a 3.3.0 build
on a device: see `../../docs/native-sdks.md`.

```sh
UI_CASES=settings-premium-none-en,settings-premium-until-en,settings-premium-lifetime-en,settings-premium-restoring-en,settings-premium-web-en,settings-premium-none-sv,settings-premium-until-sv,settings-premium-lifetime-sv,settings-premium-restoring-sv,settings-premium-web-sv \
  UI_VIEWPORTS=portrait,small-portrait,landscape,tablet-portrait \
  MOBILE_BASE_URL=http://localhost:8081 bun run test:ui
```

## `/home?fixture=ad-<state>` — A short ad, then we deal (PID-120)

The sheet that opens instead of dealing when the server says the next solo game needs a
short ad (`/me.ads.next_game_needs_ad`, or a `402 AD_REQUIRED` from room creation). The
same sheet opens from Home's Quick game, the empty Tables screen and Play again after a
solo game. The fixture sets only the state it opens in; Watch the ad on the web answers
`unavailable`, which reports to the server and deals, so the grammar never taps it.

| `state`       | Shows                                                                    |
| ------------- | ------------------------------------------------------------------------ |
| `offer`       | The ad is loaded: Watch the ad (wood), Go Premium (glass), the free line |
| `loading`     | The ad is loading: Watch the ad busy, everything else as `offer`         |
| `dismissed`   | The ad closed early: "Watch it to the end and we deal.", Watch the ad    |
| `unavailable` | No ad: "No ad right now, so we deal." while dealing; nothing else to tap |

testIDs `ad-sheet`, `ad-watch`, `ad-premium`, `ad-close`. Grammar cases
`ad-sheet-{offer,loading,dismissed,unavailable}-{en,sv}` at 390×844, 375×667, 844×390 and
768×1024 assert the copy, 44pt targets, no clipping or scrolling, and no digit or `!` in
the sheet. The rewarded ad and Google's consent form need a development build on a
device (`../../docs/native-sdks.md`); the browser has no ads.

`/ui-dev?state=settings&fixture=privacy-choices` forces Settings → **Privacy**, its own
section after the game settings and before About the app (PID-119), which a phone shows
only when Google's consent status says a privacy options form is required. Grammar cases
`settings-privacy-choices-{en,sv}` also check that the section, heading included, is
absent without the fixture.

```sh
UI_CASES=ad-sheet-offer-en,ad-sheet-loading-en,ad-sheet-dismissed-en,ad-sheet-unavailable-en,ad-sheet-offer-sv,ad-sheet-loading-sv,ad-sheet-dismissed-sv,ad-sheet-unavailable-sv,settings-privacy-choices-en,settings-privacy-choices-sv \
  UI_VIEWPORTS=portrait,small-portrait,landscape,tablet-portrait \
  MOBILE_BASE_URL=http://localhost:8081 bun run test:ui
```
