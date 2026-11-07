# Shipping a store build (beta)

Over-the-air updates only reach installs of the **same app version** (runtime policy `appVersion`). When `version` in `packages/mobile/app.json` goes up, every later beta update goes to the new version only, and nobody gets it until the store build is in their hands. So a version bump is not done until all steps below are done, on **both** platforms, the same day.

The Beta update workflow says **"New store build needed"** when a commit needs this.

## 1. Build

From `packages/mobile`: `eas build --profile beta --platform all`. Note the build numbers (Android version code, iOS build number).

## 2. Android: Play open testing

Play Console → Pidro Beta (`com.oneapps.pidro.beta`) → Test and release → **Open testing**. That track is the store listing testers use: <https://play.google.com/store/apps/details?id=com.oneapps.pidro.beta>.

1. Create new release → add the new AAB → release notes → Next → Save and publish.
2. If Publishing overview lists changes, **Send changes for review**. Google reviews again, often for hours.
3. If the track says **Paused**, choose Resume track. An approved submission can leave it paused, and then nobody upgrades.
4. Done when Open testing shows the new version as "Available to unlimited testers · Released on …".

## 3. iOS: TestFlight external group "Friends"

App Store Connect → Pidro Beta (ASC 6816832730) → TestFlight. The external group **Friends** owns the public link <https://testflight.apple.com/join/2JR95b65>, so that is where players are.

The internal group **Team** is only us. A build that only reaches Team reaches no players. That's how iPhone players stayed on 3.2.1 from 2026-10-21 to 2026-11-07.

1. Upload: `eas submit --profile beta -p ios`, or upload from the build page.
2. Friends → Builds → **+** → pick the build → What to Test (English, a line in Swedish) → keep "Automatically notify testers" → **Submit for Review**.
3. Done when the build shows "Testing" in the Friends group, not "Waiting for Review".

## 4. Point older installs to the store

In `pidro_backend/config/deploy.yml` set `MINIMUM_NATIVE_ANDROID` / `MINIMUM_NATIVE_IOS` to the new version, **only once that platform's step above is done**. Push to backend `main`; the deploy applies it. Installs below it that already have the store notice show "A new version is in the store" with the store link. The store URLs sit next to them (`NATIVE_STORE_URL_*`) and change at public launch.

## 5. Check a day later

Players by app version over the last 24 hours (production eval, see backend `docs/deploy.md`):

```sql
select app_version, platform, count(distinct user_id)
from seat_events
where inserted_at > now() - interval '24 hours' and app_version is not null
group by 1, 2 order by 1, 2;
```

If an old version still has many players, check the platform's step again before anything else.
