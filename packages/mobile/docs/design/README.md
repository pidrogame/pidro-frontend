# Design boards

The approved designs for the avatar, the table seats, the profile, leagues and the Tables screens, exported from Marcel's design canvas on 2026-10-14; the Tables boards were replaced on 2026-10-15 (PID-202), and the end-of-hand, game-over and share boards were added on 2026-10-16. The Friends and New table boards were added on 2026-10-19 (epics PID-239 and PID-240), and the password-seat boards the same day (PID-259). The canvas itself is private (https://claude.ai/artifact/QNDfktYA6aE65LywZGW7so), so this folder is the copy a ticket works from.

- `boards/<Name>.png`: what it should look like. Phone boards are at 2×, wide boards at 1×.
- `source/<Name>.html`: the same board as plain HTML and CSS. Open it in a browser, or read it for exact sizes, offsets and colours. The shared classes are in `source/pidro-ds-v2.css`.

The boards are drawn in CSS, not React Native. Read them as a spec: match the sizes, positions, order and wording. Build with the app's primitives and tokens (`src/design/README.md`), never by pasting a hex value into a screen. If a colour on a board has no token yet, add one to `src/design/tokens.ts` under a name that says what it is for.

Initials stand in for photos on the boards. In the app the avatar is the player's photo, with the existing fallback image when there is none.

## Boards

| Board | What it shows | Used by |
| --- | --- | --- |
| `Avatars` | The avatar: ring, pin, level chip, turn light, dealer chip, and which parts show at which size | Avatar component |
| `Seat-States` | Every state one seat can be in, with its status line | Avatar component, table seats |
| `Table-Seats` | Phone portrait table: name and status under the avatar | Table seats |
| `Table-Landscape` | Phone landscape: name beside the avatar, East on the left, everyone else on the right | Table seats |
| `Table-iPad-Portrait` | iPad portrait: like the phone portrait, larger | Table seats |
| `Table-iPad-Landscape` | iPad landscape: like the phone landscape, larger | Table seats |
| `Main` | Profile of a Classic player | Profile |
| `Profile-New` | Profile of a new player | Profile |
| `Badge-Sheet` | The sheet behind the avatar: ring, and which pin to wear | Profile |
| `Ladders` | Week, month, all time | League tab, later leagues |
| `League`, `League-Intro`, `League-Result` | The weekly league: tab, first visit, Monday's result | Later; not before launch |
| `Lobby-Empty` | Tables with nobody playing: four empty chairs, Start a table | Tables (PID-203) |
| `Lobby-List` | Tables, phone portrait: rows of chairs grouped in four categories, tap an open chair to sit | Tables (PID-203) |
| `Lobby-Landscape`, `Lobby-iPad-Portrait`, `Lobby-iPad-Landscape` | The same row in two columns (phone landscape, iPad portrait) and three (iPad landscape) | Tables (PID-203) |
| `Create-Table` | Superseded by `New-Table` (PID-255). Start a table: rules, then the seats with Open / Bot / Friend | Start a table (PID-204, PID-206) |
| `Create-Seat` | Superseded by `New-Table-Seat` and `New-Table-Friends` (PID-256). The friend sheet behind Friend on a seat | Start a table (PID-208) |
| `Friends` | The Friends tab: requests to answer on top, Online now (Join / Play), Not online, Waiting for an answer, the Classic card; action pill, ×, count badge | Friends screen (PID-248), components (PID-241, PID-242) |
| `Friend-Sheet` | Tapping a friend: a short profile with one main button, then profile, remove, block (with in-sheet confirms) | Friend sheet (PID-249) |
| `Friends-Add`, `Friends-Empty` | Add a friend (rows stay and say Sent) and Friends with nobody yet | Add and empty (PID-250) |
| `Friend-Notice`, `Friend-Notices` | The notice above the tabs, and every notice: request, accepted, seat held, can't come, too late; the badge | Notices (PID-246, PID-254), notice card (PID-242) |
| `Invite-Solo` | A seat invitation arriving during a game with bots, at the top of the table | PID-258 |
| `New-Table`, `New-Table-Open` | New table as one screen: Your team vs Opponents, one row per seat; the same screen once opened | New table (PID-255), seat row (PID-243) |
| `New-Table-Seat`, `New-Table-Friends` | Tapping a seat: one choice in two groups, then the full-height friend list | Seat picker (PID-256), components (PID-244) |
| `New-Table-Landscape`, `New-Table-Landscape-Picker` | Phone landscape: the teams side by side; the picker full screen, friends in two columns | PID-257 |
| `New-Table-iPad`, `New-Table-iPad-Landscape`, `New-Table-iPad-Picker` | iPad portrait and landscape; the picker as a centered panel | PID-257 |
| `Password-Seat` | Tables with a password seat: the open chair carries the same gold lock as on New table | Password seat (PID-259) |
| `Password-Keypad` | Tapping it: "This seat needs a password", four big boxes, a number pad; the fourth number sends it | Password seat (PID-259) |
| `Password-Wrong` | A wrong password: the boxes shake gently and clear, and the line says to ask the host (the shake is a note on the board) | Password seat (PID-259) |
| `Password-Wait` | Too many tries: "Try again in a minute.", the keys greyed until then | Password seat (PID-259) |
| `Password-Landscape` | Phone landscape: the keypad beside the boxes, nothing scrolls | Password seat (PID-259) |
| `Hand-Made`, `Hand-Missed`, `Hand-Landscape` | After a hand: the table dims, one panel with the bid result and the point cards each team took; closes by itself | End of hand (PID-236) |
| `Win-Reveal`, `Lose-Reveal`, `Win-Compact`, `Win-Landscape` | Game over, won and lost, on a phone, a small phone (375×667) and in landscape. iPad uses the phone layouts at 1.25×, centred | Game over (PID-237) |
| `Win-Beats` | The win beat by beat: picture, sound and haptic, Reduce Motion, the quieter loss | Game over (PID-237) |
| `Share-Card` | The 1080×1920 story card shared from the win screen | Share the win (PID-238) |

On `Friends-Add` the link card ends "…you’ll be friends straight away"; signing up through your link sends you a friend request instead, so the app's "…their friend request waits for you here." replaces the board's line.

On the boards the gold ring means a paying supporter and the gem means lifetime. Neither exists on the server yet, so until it does every avatar uses the glass ring.

## From the boards to the app

| On the boards | In the app |
| --- | --- |
| Gold ring, medal rim, level chip edge (`#F6DE9A → #8F5E12`) | `PidroBevel.goldRimGradient` |
| Glass ring (`#D8F6FF → #17507E`, opaque) | New token next to `PidroBevel.glassRimGradient`, which is translucent and made for buttons |
| Avatar face behind the photo, level chip (`#175086`, `#0E3158`, `#0A2340`) | `PidroBevel.panelHi`, `panelMid`, `panelDeep` |
| Classic pin face (`#91541C → #4E2509`) | The wood face: `PidroBevel.woodFaceGradient` |
| Gold text (`#FFD447`) | `PidroBevel.textGold` |
| Cyan status text (`#8beaff`) | `PidroColors.cyanText` |
| Partner's name (`#92e6b2`) | Replaced (PID-294): your and your partner's names are `PidroColors.teamUs`, the others' `teamThem` |
| Turn light (`#c9f7ff`, glow `rgba(139,234,255,…)`) | New token |
| Last seconds of a turn (`#ffb86b`) and reconnecting (`#ffb4b9`) | `PidroColors.warning` and `PidroColors.danger`, or new tokens if those read wrong on the felt |
| Bree Serif, Nunito | `PidroFonts` |
| Felt | The app's own felt |
