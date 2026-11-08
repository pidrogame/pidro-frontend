# English / Swedish delivery

The current Expo app uses one shared, typed catalog composition in
`packages/shared/src/i18n`. Language is a device preference, independent of rules,
account and table. Settings offers English and Svenska only (2026-11-08). A new
install, or one that saved System before, takes the device's language once and
saves it: ordered preferred languages resolve to English or Swedish (`sv-SE` and
`sv-FI` both resolve to `sv`), otherwise English. Persisted settings resolve before
the first player-facing copy.

Mounted consumers subscribe without replacing navigation, socket or game state.
Memoized presentation includes locale; queued notices and ticker entries retain
their event identity and translate at presentation. Missing player names stay
missing in transport/state; only presentation supplies a localized fallback.
Usernames, room names, invite codes, suits/positions on the wire and server-owned
scores/legal actions are not translated or recalculated.

## Design and fixtures

- Spec: `packages/mobile/docs/design/source/Localization.html`
- Reviewed board: `packages/mobile/docs/design/boards/Localization.png`
- Runtime: Settings uses existing ScreenShell/ScreenHeader/Surface/PidroText and
  PressableFX, with 48px glass radio choices, checked state and keyboard support.
- Fixtures: `packages/mobile/docs/FIXTURE-ROUTES.md`, bounded locale overrides on
  `/ui-dev`, `/table-dev`, `/auth-flow-dev` only. Real navigation ignores them.
- Grammar covers EN/SV settings selections and seven gameplay phases at 390×844,
  844×390, 667×375, 360×640 and 768×1024. These are browser dimensions, not devices.
- Every portrait trump window reserves North's full avatar/name/status stack and
  the player's hand. Compact art/spacing follows available height, not a phone
  size category; Swedish type and at least 48pt suit targets remain readable.

## Source translation mapping

Authoritative terminology reference: committed original
`docs/reference/unity-localization/{English,Swedish}.txt`. The originals remain
unchanged. Current English copy and backend behavior govern the new sentences.
Catalog sections place English and Swedish side by side for review.

| Current catalog | Unity source | Treatment |
| --- | --- | --- |
| `shell`: settings language/sound/on/off | `TID_Language`, `TID_Sound`, `TID_On`, `TID_Off`, `TID_SettingsCaps` | Språk, Ljud, På, Av; sentence case |
| `auth`: sign-in/form/actions | `TID_SignIn`, `TID_UserName`, `TID_Password`, `TID_EmailAddress`, `TID_Cancel`, `TID_Continue` | Reuse vocabulary; current full sentences |
| `social`: friends/home/lobby | `TID_Friends`, `TID_Host`, `TID_QuickJoin`, `TID_Multiplayer`, `TID_VS` | Vänner, värd, Snabbspel, Spela online, mot |
| `friends` in `social`: PID-224 list/search/add-back/remove | Current merged Friends flow; Unity supplies Vänner terminology | New complete sentences and accessible actions; presence/relation enums and player identities stay unchanged |
| `social`: profile statistics | `TID_PlayedGames`, `TID_Wins`, `TID_Loses`, `TID_WinningPercentage` | Spelade spel, vinster, förluster; locale number formatting |
| `game`: bids/suits/turns | `TID_Bet`, `TID_Pass`, `TID_Passed`, `TID_ChooseASuit`, `TID_DealerChip` | Bud, passa/passade, färg, givare; complete interpolated sentences |
| `game`: PID-214 high-bid status | Current server-owned bid presentation; Unity supplies Bud terminology | Bud 9 · högst / Högst 9; pulse identity remains hand + wire bid, never translated text |
| `game`/`shell`: PID-220 out of trumps, count help, last trick, pace | No matching Unity flow; Unity supplies stick/bud terminology | Ute, Tar resten, Förra sticket, "%{taken} av %{bid}", Hjälp mig hålla räkningen, Lugnare tempo; Swedish review requested |
| `game`: PID-236 end of hand | No matching Unity flow; Unity supplies bud/bet terminology | Klarade det, "Bet med %{n}", "%{name} tog deras Pidro"; Swedish review requested |
| `core`: original invite/rules keys | `TID_Invite`, `TID_Loading`, `TID_Cancel`, `TID_Host` | Existing English preserved; modern invite and rules sentences newly translated |
| `errors` | Backend manifest meanings, Unity bud/färg/givare vocabulary | 119 explicit codes, safe typed params; no raw exception text |
| New account/guest/Classic recovery, updates, accessibility | No matching current Unity flow | Newly translated from current app meaning |

Corrections/exclusions: `TID_Select` uses imperative **Välj**, not Unity's **Välja**;
English/Svenska are autonyms (not **Engelska**). Unity's Finnish deletion strings,
mixed-English score failures, inconsistent sort/färg, trailing-space XP key and
fragmented sentence patterns are not imported. Do not import old OTP/password
emailing, subscription-gated rematches or tutorial rules into current flows.
Louisiana explanations remain based on the current app/server contract.

Swedish review remains requested for **medspelare**, **returmatch**, **bot/botar**,
**koppla** (Classic claim), **offentligt namn**, **gästspel**, **solobord**,
**Spelstyrka**, **Testare från starten**, **Stöttepelare**, **Gesäll/Stormästare**,
the count help hint (**Visa vilket kort som vinner, vad budgivarna har tagit och
förra sticket.**, PID-230), the end of a hand (**Klarade det**, **Bet med 3**,
**Nora tog deras Pidro**, PID-236), the Classic claim's new-password reason
(**Din Pidro-inloggning**, **Pidro är en ny app med egen inloggning, så välj ett nytt
lösenord för den. Ditt Classic-lösenord stannar i Classic.**) and trump-killing terminology. No native-speaker approval is claimed.

PID-246 adds **%{count} väntar på ditt svar** to the Swedish review list. The
shell reuses the existing request, accepted, Not now and seat-held translations
from `social.ts`; native-speaker approval is still pending for these notice lines.

## Backend rollout

PID-248 Swedish review: **Vill bli vänner**, **Online nu**, **Väntar på svar**,
**Acceptera %{name}**, **Dölj förfrågan från %{name}**,
**Avbryt din vänförfrågan till %{name}**, **Förfrågan dold/avbruten. %{name} får inget meddelande.**,
**Ångra**, **Gå med vid %{name}s bord**, **Starta ett bord med %{name}**,
the friend/online count, and **Det finns ingen ledig plats för dig vid det här bordet.**
No native-speaker approval is claimed.

Companion: https://github.com/marcelfahle/pidro-backend/pull/94.
`docs/contracts/backend-localization-errors.json` is the exact fetched manifest;
its sibling Markdown records source commit/hash and adapter behavior. Structured
codes win over old fields. Known stable legacy identifiers still work; uncoded
failures get translated context fallbacks. Parallel `field_errors` retain field
identity and server length parameters, including across live language changes.
The frontend works before the backend contract is deployed.
Guest-save recovery recognizes the exact legacy uniqueness detail
`has already been taken` only when no authoritative structured reason wins.
Structured email/name uniqueness retains the established account-recovery copy
and flags; invalid format and password lengths preserve their actual reasons.

## Native and OTA boundary

PID-250 Swedish review (not native-speaker approved): **Hitta en spelare efter namn**,
**Spelat med nyligen**, **Din vän**, **Väntar på att %{name} tackar ja**,
**Förfrågan skickad. Ni blir vänner när %{name} tackar ja.**,
**Kom och spela Pidro med mig: %{url}**, **De du spelar med visas här efter ett spel.**,
and **Lägg till dem du tycker om att spela med. När de tackat ja ser du när de är
online och kan bjuda in dem till ditt bord.** The existing Send your link card's
Swedish title, body and action also need review in their new screen context.

PID-247: signing up through someone's link sends them a request, so the notice reuses
**Förfrågan skickad. Ni blir vänner när %{name} tackar ja.** (listed under PID-250), and the
link card's body is now **Skicka din länk. När de har installerat Pidro och skapat ett konto
väntar deras vänförfrågan här.**

`expo-localization` was already installed; no new native dependency. App config
declares en/sv support and localized iOS photo-library permission copy. Camera and
microphone permission requests remain disabled. These generated native resources
require a future native build; JavaScript catalogs, settings and live switching
can work over OTA on the current compatible runtime. No OTA or native release
build was run. OS permission dialogs and Apple's native sign-in button follow OS
localization, not a JavaScript-only override.

This Linux orb cannot certify native safe-area measurement, screen-reader
pronunciation, large native font scaling or OS locale change behavior on a device.
Before a native release, check both languages in iOS/Android system settings,
the first launch taking the device's language, photo
permission prompts, VoiceOver/TalkBack, notch/system bars and both rotations.
Synthetic browser inset checks do not replace those checks.

Parent device review on 2026-10-15 passed on iPhone 17 Pro, iOS 26.5, Expo Go 56,
with real insets: EN→SV→EN Settings, portrait and both landscape orientations.
The Swedish portrait trump window clears North by 13pt and the hand by 45pt;
all four choices fit and remain 48pt tall. The landscape System radio stays
inside its Surface, and all language targets remain 48pt. The actual declaring
game state with nine cards clears the hand by 11pt in landscape (68pt targets).
This approval does not certify Android, permission dialogs, screen readers,
OS-locale foreground behavior or large native font scaling.

Parent additionally approved the PID-224 integration on iPhone 17 Pro/iOS 26.5:
Swedish added-you/list, Nora's profile, removal confirmation/cancel and landscape
search. A real (nonfixture) Swedish preference survived termination/relaunch,
then switched back to English. Literal names were preserved.

Baseline review from Frontend CI run `38802016091` accepted ten Settings captures,
portrait trump and landscape Louisiana results, plus 145 new EN/SV fixture
captures. The five wrapped-toolbar drifts were rejected; the compact visible
Leave/Lämna label restores the earlier layout while the accessible name stays
Leave table/Lämna bordet. Main's existing waiting/table baselines are preserved.
New waiting-label and PID-214 Swedish bid captures require the subsequent CI run.

## Validation commands

`bun run shared:build`; `bun run test:unit`; in `packages/mobile`,
`bunx tsc --noEmit` and `bun run lint`; `bun run web:build` from root.
Focused contract/reactivity tests live alongside existing unit suites. Real
settings persistence, focus and document language are tested by
`e2e/specs/settings-language.spec.ts`. Full Frontend CI additionally covers UI
grammar, production export, real backend games and account journeys. The PR
records exact final run/results and only intentionally refreshed baselines.

PID-260 Swedish review (not native-speaker approved): **Spelade tillsammans %{when}**
on Add a friend, the bare capitalised day on empty Friends (**Idag**, **Igår**,
**För 2 dagar sedan**), and the PID-242 lines that now show with server facts:
**Vid ett bord · 1 ledig plats** / **2 lediga platser**, **Vid ett bord · giv 4**,
**Spelade igår**, **Spelade i september**, **Frågade idag**, **Frågade för 3 dagar sedan**.

## PID-249 Swedish review — pending native review

All new `friend_sheet` lines below await native-speaker review; no approval is claimed.

| Key | Swedish |
| --- | --- |
| `friend_sheet.partner_status` | Vid ett bord · partnerplats ledig |
| `friend_sheet.opponent_status` | Vid ett bord · motståndarplats ledig |
| `friend_sheet.full_status` | Vid ett bord · inga lediga platser |
| `friend_sheet.join` | Gå med vid %{name}s bord |
| `friend_sheet.partner_hint` | Du spelar som partner till %{name}. |
| `friend_sheet.opponent_hint` | Du spelar mot %{name}. |
| `friend_sheet.play` | Spela tillsammans |
| `friend_sheet.online_hint` | Startar ett nytt bord med %{name} som din partner. |
| `friend_sheet.offline_hint` | Din inbjudan väntar på %{name} i Pidro. |
| `friend_sheet.profile` | Visa hela profilen |
| `friend_sheet.remove` | Ta bort från vänner |
| `friend_sheet.block` | Blockera %{name} |
| `friend_sheet.remove_title` | Ta bort %{name} från dina vänner? |
| `friend_sheet.remove_body` | Ni tas bort från varandras vänlistor. %{name} får inget meddelande. |
| `friend_sheet.remove_confirm` | Ta bort |
| `friend_sheet.keep` | Behåll %{name} |
| `friend_sheet.block_title` | Blockera %{name}? |
| `friend_sheet.block_body` | %{name} kan inte hitta dig, lägga till dig eller sätta sig vid dina bord, och ni är inte längre vänner. Du kan avblockera %{name} när som helst i Profil. |
