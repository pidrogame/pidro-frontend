# Shipping a store build (beta)

The beta keeps **version 3.3.0**. A store build changes only its build number (iOS build number, Android version code), which EAS counts up by itself (`appVersionSource: remote`, `autoIncrement` in `eas.json`). Don't touch `version` in `packages/mobile/app.json`; a version bump is for the public App Store launch, where the store demands one.

Over-the-air updates reach only builds with the same **runtime**, and the runtime is the project's **fingerprint** (`runtimeVersion: { policy: "fingerprint" }`): a hash of what the binary is built from (config plugins, native packages, native config, `fingerprint.config.js` says what is left out). It stays the same across JS-only commits and changes the moment native code changes. iOS and Android have a fingerprint each.

The Beta update workflow says **"New store build needed"** (iOS, Android or both) when a commit's fingerprint matches no beta build or update for that platform. That means native code changed since the last store build. The summary names the fingerprint, the last build and what changed. The other platform keeps getting updates. Build the platforms it names, with the version unchanged, using the steps below. Updates resume on top of the new build.

If the summary still says "New store build needed" for a commit you just built from, the fingerprints of the build and the update differ. From `packages/mobile`, `bunx eas-cli fingerprint:compare` shows what differs.

## 1. Build

Three machines compute the fingerprint of one commit: your Mac when `eas build` starts (it is recorded on the build), the EAS worker (which stops the build at "Configure expo-updates" with "Runtime version mismatch" / "Differing fingerprint" when its own differs) and GitHub Actions (the Beta update). They agree as long as the Mac builds the same files. Two things on a laptop differ from the worker, and `fingerprint.config.js` evens both out:

- **The Firebase file.** On EAS, `GOOGLE_SERVICES_JSON` is a file variable, and the fingerprint leaves the file out. Point the variable at your local copy so the Mac reads the same config the worker does.
- **masked-view's manifest.** Running Android once (Gradle sync, `expo run:android`) rewrites `@react-native-masked-view/masked-view/android/src/main/AndroidManifest.xml` inside `node_modules`. The fingerprint leaves that file out; before 3.3.0 (19)/(15) it failed every build from the Mac.

1. Build from `main` once its Beta update said "New store build needed": `git checkout main && git pull`, nothing uncommitted, then from the repo root `bun install --frozen-lockfile`.
2. Check first, from `packages/mobile`: `GOOGLE_SERVICES_JSON=<local copy> bunx eas-cli fingerprint:generate --build-profile beta --platform ios --non-interactive --json | jq -r .hash`, and the same with `--platform android`. Each must equal the fingerprint the Beta update summary names for that platform. If one differs, don't build: `bunx eas-cli fingerprint:compare` shows the file.
3. Build, from `packages/mobile`, with the App Store Connect key for the iOS submit (`EXPO_ASC_API_KEY_PATH`, `EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID`) in the environment: `GOOGLE_SERVICES_JSON=<local copy> eas build --profile beta --platform all --auto-submit --non-interactive --no-wait` (or `--platform ios` / `android` for one). Don't set `EAS_SKIP_AUTO_FINGERPRINT`: the worker compares anyway.

Note the build numbers EAS gives (iOS build number, Android version code). Updates flow again when the next Beta update summary says **"Beta update published"** for the platform and that it rides on build 3.3.0 (that number).

## 2. Android: Play open testing

Play Console → Pidro Beta (`com.oneapps.pidro.beta`) → Test and release → **Open testing**. That track is the store listing testers use: <https://play.google.com/store/apps/details?id=com.oneapps.pidro.beta>.

1. Create new release → add the new AAB → release notes → Next → Save and publish.
2. If Publishing overview lists changes, **Send changes for review**. Google reviews again, often for hours.
3. If the track says **Paused**, choose Resume track. An approved submission can leave it paused, and then nobody upgrades.
4. Done when Open testing shows the new version code as "Available to unlimited testers · Released on …".

## 3. iOS: TestFlight external group "Friends"

App Store Connect → Pidro Beta (ASC 6816832730) → TestFlight. The external group **Friends** owns the public link <https://testflight.apple.com/join/2JR95b65>, so that is where players are.

The internal group **Team** is only us, and sees every build as soon as it is processed. A build that only reaches Team reaches no players. That's how iPhone players stayed on 3.2.1 from 2026-10-21 to 2026-11-07.

Apple's Beta App Review looks at the **first build of a version** (3.2.4 took about 15 hours). Later builds of the same version usually reach Friends once processed, without another review. Add every build to Friends anyway.

1. Upload: `eas submit --profile beta -p ios`, or upload from the build page.
2. Friends → Builds → **+** → pick the build → What to Test (English, a line in Swedish) → keep "Automatically notify testers" → **Submit for Review** (a later build of the same version usually passes at once).
3. Done when the build shows "Testing" in the Friends group, not "Waiting for Review".

## 4. Point older installs to the store

Admin → **Store builds** (`/admin/store-builds`) shows, per platform, the newest build, its review state, what players can install now, the minimum, and players per version and build, with the next step on top. Check it before and after every release. Google Play is read only when you press Refresh there (it shares the EAS submit account), so don't press it while an Android submission is running.

Once a platform's step above is done, publish an **app-update News post** (Admin → News, "App update" on) with the "show below" **version and build** set for **both** platforms, such as 3.3.0 build 15 on iOS and 3.3.0 version code 12 on Android. The newest app-update post owns both platforms, and an empty field means no minimum there. The Store builds page's "New app-update post" button fills them in. An install below the version, or on that version below the build, gets the pop-up and the "A new version is in the store" notice with the store link. An app older than PID-398 sends no build, so only the version counts for it. `MINIMUM_NATIVE_*` in `pidro_backend/config/deploy.yml` is only the version fallback when no app-update post exists. The store URLs (`NATIVE_STORE_URL_*`) stay in that file and change at public launch.

## 5. Check a day later

Players by app version and build over the last 24 hours (production eval, see backend `docs/deploy.md`):

```sql
select platform, app_version, app_build, count(distinct user_id)
from seat_events
where inserted_at > now() - interval '24 hours' and app_version is not null
group by 1, 2, 3 order by 1, 2, 3;
```

If an old build still has many players, check the platform's step again before anything else.
