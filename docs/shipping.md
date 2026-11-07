# Shipping to beta testers

Before pushing, satisfy the risk-based [testing and proof contract](testing.md).
`Frontend ready` is the authoritative selected CI gate, not native iOS evidence.
Native-risk changes must have their required simulator/device/build evidence before
the push: the automatic beta workflow does not collect it or wait for manual QA.
Missing required evidence means verification incomplete, even when checks are green.

A commit pushed to `main` reaches beta testers' phones by itself:

1. Frontend CI runs on `main`.
2. When it is green, the **Beta update** workflow (`.github/workflows/beta-update.yml`,
   `packages/mobile/scripts/publish-beta.mjs`) publishes the commit to the `beta` branch
   over the air, the same as the manual command:

   ```bash
   APP_VARIANT=beta EXPO_PUBLIC_API_URL=https://app.pidro.online \
   EXPO_PUBLIC_WS_URL=wss://app.pidro.online/socket \
   bunx eas-cli update --branch beta --environment production --message "..." --non-interactive
   ```

   Its run summary shows the update group and the dashboard link.

It does not publish when:

- **Something native changed** since the last beta build or update for this runtime
  (`ios/`, `android/`, `app.config.*`, app.json's native fields and the files they point
  at, or a package with native code). The summary lists what and says a new store
  build is needed: bump `version` in `packages/mobile/app.json` and ship a beta build.
  Check a range yourself from `packages/mobile`: `node scripts/ota-check.mjs <base> [head]`.
- `main` has already moved on (a newer commit publishes instead), beta already carries
  a newer commit, or this commit went to beta before (so re-running CI after a rollback
  can't bring a bad update back).
- Nothing in the app changed (docs, `packages/web`).
- There is no `EXPO_TOKEN` secret.

## Rolling back

From `packages/mobile`, with a logged-in `eas` CLI or `EXPO_TOKEN`:

```bash
node scripts/rollback-ota.mjs --dry-run    # the last beta groups and what it would pick
node scripts/rollback-ota.mjs              # republish the group before the current one
node scripts/rollback-ota.mjs <group-id>   # republish that group
```

Testers get the rolled-back group the next time the app checks for updates.

**Roll back** when testers are stuck: the app crashes on start, sign-in fails, or a
game can't be played, and the fix is more than a few minutes away. Rolling back buys
time; it does not fix `main`. The next green commit on `main` publishes over the
rollback, so revert or fix the bad commit there.

**Fix forward** for everything else: a wrong word, a misplaced control, a bug with a
way around it. Push the fix; green `main` publishes it.

Once beta is rolled back, the script won't pick "the one before" again (that would be
the bad update); pass a group id to go further back.
