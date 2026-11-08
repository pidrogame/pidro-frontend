# Locale foundation

`catalogs.ts` is the single composition for shared/native/web consumers. Keep
flat namespaced keys and add both `en` and `sv` in the owned section module
(`auth`, `social`, `game`, `shell`). `core` contains the pre-existing mobile
catalog, moved without changing its English keys or copy. Section keys must not
collide with each other. Use `TranslationEntry` for plural entries (`one`,
`other`, optionally `zero`) and pass `{ count }` to `t`.

Persist **preferences** through the existing settings store's
`setLanguage('en' | 'sv')`. `setLocale('en' | 'sv')` only changes the runtime
locale; it does not save a preference. A new install, or a `'system'` saved by an
older build, takes the device's language once (`resolveLocale` over the ordered
tags the platform passes as `detectLanguageTags`, so shared never imports a
platform API) and saves it. The mobile root waits for settings hydration, sets
the runtime locale and subscribes to settings.
Normal routes ignore locale parameters. Only the guarded development fixture
boundaries install temporary, nonpersisted overrides; see mobile's fixture guide.

Use mobile `useTranslation()` (`{ t, locale }`) or shared `useLocale()` in mounted
consumers, including canvas-label owners. Bare `t()` and `formatNumber` /
`formatDate` read the current locale but do not subscribe callers. Include
`locale` in memo/effect dependencies for derived copy. Dates follow the device
timezone unless an explicit `timeZone` option is supplied. Unknown device
languages/detection failures fall back to English; Swedish variants resolve to
`sv`, English variants to `en`, in device-preference order.

## Translation provenance and review

Reference: `docs/reference/unity-localization/{English,Swedish}.txt`. Reused
`TID_Cancel` → **Avbryt**, `TID_Loading` → **Laddar**, `TID_Host` → **värd**,
`TID_Invite` → **Bjud in**, and `TID_Bet` → **bud**, adapting Classic's title-case
labels to sentence case. Existing invite, seat-management and rules explanatory
sentences are newly translated; Classic does not cover these exact flows.
Louisiana text follows the current English/server rules, not Classic tutorials.
No known Finnish contamination or Classic's `TID_XP ` typo was imported.

Human Swedish review is still required, particularly **medspelare**, **returmatch**,
**bot**, **femman i samma färg**, and the grammatical inflection of rule names in
`rules.empty` / `rules.emptySearch`. This is not native-speaker approval.

Validation: `bun test packages/shared/test/i18n.test.ts
packages/shared/test/i18n-react.test.tsx` and `bun run shared:build`.
Native language metadata and photo-library permission descriptions require a
future native build to take effect; they are not OTA-verifiable.
