# Pidro frontend

The React Native app is `packages/mobile` (start with its `AGENTS.md`); shared types and
API clients are `packages/shared`; `packages/web` is the old web client.

## Shipping

Trunk-based: no pull requests.

1. **Prove it.** From the root `bun run shared:build && bun run test:unit`; in
   `packages/mobile` `bunx tsc --noEmit && bun run lint`, plus screenshots for anything
   visible. Show the proof in the thread; it replaces the review.
2. **Push to `main`.** A few small commits, `git pull --rebase origin main` first.
3. **A green `main` publishes the beta update by itself.** When Frontend CI passes on
   `main`, the Beta update workflow publishes that commit over the air to beta testers,
   or says in its run summary that a new store build is needed (native change).
   Watch `main` until it is green; if you turned it red, fix forward right away.
   A push runs only the checks its change touches (`packages/mobile/scripts/ci-affected.mjs`;
   the "Select checks" summary says why). The full release test is Actions → Frontend CI →
   Run workflow; it runs everything and never publishes.
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
- IAP and entitlements: none in the client yet; any code that adds them
- Navigation: `packages/mobile/app/_layout.tsx`, `app/(auth)/_layout.tsx`,
  `app/(shell)/_layout.tsx`, `app/index.tsx`, `app/+native-intent.tsx`
- The socket and channels: `packages/mobile/src/channels/`,
  `packages/mobile/src/bootstrap/realtime.ts`
- Everything in `packages/shared/`
