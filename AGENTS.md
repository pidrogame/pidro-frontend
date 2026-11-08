# Pidro frontend

The React Native app is `packages/mobile` (start with its `AGENTS.md`); shared types and
API clients are `packages/shared`; `packages/web` is the old web client.

## Shipping

Trunk-based: no pull requests.

1. **Prove the changed behavior.** Marcel's requirement is non-negotiable:
   **"I always want the expectations to be that the orb needs to provide irrefutable
   proof that whatever it has built is working."** Follow [`docs/testing.md`](docs/testing.md):
   run the changed behavior and only affected tests, at one standard phone size
   (plus one other size only for a named layout risk). **Orbs must not run the full
   suite, full screenshot matrix, full gameplay/account regression or native checks
   during feature work.** Those belong to Marcel's machine or deliberate release
   verification. Show the scenario, control and observed results; green tests alone
   are not proof, and browser evidence is not native iOS proof. Missing focused proof
   means **implemented, verification incomplete/blocked**. Explicitly list release/
   native coverage left pending; never claim release ready without it. Proof replaces
   routine review, not the independent review below.
2. **Push to `main`.** A few small commits, `git pull --rebase origin main` first.
3. **A green `main` publishes the beta update by itself.** When Frontend CI passes on
   `main`, the Beta update workflow publishes that commit over the air to beta testers,
   or says in its run summary that a new store build is needed (native change).
   **Do not foreground-wait on long CI** (no watch/poll/sleep loops). Report commit,
   run URL and current state; pending is not green/deployed. Fix a reported failure
   caused by your change. No schedules/subscriptions without authorization.
   Every push runs affected tests plus small smoke, never an implicit full fallback
   (`packages/mobile/scripts/ci-affected.mjs`). Full release regression is manual:
   Actions → Frontend CI → Run workflow (`full=true`); it never publishes by itself.
   `Frontend ready` is the authoritative push aggregate; `Frontend ready (full)`
   certifies complete automated regression for a deliberate release, not native QA.
4. **Roll back** with `node scripts/rollback-ota.mjs` from `packages/mobile`.
   When to roll back and when to fix forward: [docs/shipping.md](docs/shipping.md).

## Load-bearing paths

A diff touching any of these gets an independent review before the push
(`coderabbit review --plain`, `codex review`, or a separate skeptical pass):

- Design tokens and UI primitives: `packages/mobile/src/design/`,
  `packages/mobile/src/components/ui/`
- Auth, sessions and Classic claims: `packages/mobile/src/stores/auth.ts`,
  `packages/mobile/src/api/auth.ts`, `packages/mobile/src/api/classic.ts`,
  `packages/mobile/src/features/auth/`, `packages/mobile/app/(auth)/`
- IAP, ads and push: `packages/mobile/src/features/{premium,ads,push}/`, the native SDK
  config in `packages/mobile/app.config.js` ([docs/native-sdks.md](docs/native-sdks.md))
- Navigation: `packages/mobile/app/_layout.tsx`, `app/(auth)/_layout.tsx`,
  `app/(shell)/_layout.tsx`, `app/index.tsx`, `app/+native-intent.tsx`
- The socket and channels: `packages/mobile/src/channels/`,
  `packages/mobile/src/bootstrap/realtime.ts`
- Everything in `packages/shared/`
