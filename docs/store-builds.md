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

Admin → **Store builds** (`/admin/store-builds`) shows, per platform, the newest build, its review state, what players can install now, the minimum, and players per version, with the next step on top. Check it before and after every release. Google Play is read only when you press Refresh there (it shares the EAS submit account), so don't press it while an Android submission is running.

Once a platform's step above is done, publish an **app-update News post** (Admin → News, "App update" on) with **both** "show below version" fields set: the newest app-update post owns both platforms, and an empty field means no minimum there. The Store builds page's "New app-update post" button fills both in. Installs below it get the pop-up and the "A new version is in the store" notice with the store link. `MINIMUM_NATIVE_*` in `pidro_backend/config/deploy.yml` is only the fallback when no app-update post exists. The store URLs (`NATIVE_STORE_URL_*`) stay in that file and change at public launch.

## 5. Check a day later

Players by app version over the last 24 hours (production eval, see backend `docs/deploy.md`):

```sql
select app_version, platform, count(distinct user_id)
from seat_events
where inserted_at > now() - interval '24 hours' and app_version is not null
group by 1, 2 order by 1, 2;
```

If an old version still has many players, check the platform's step again before anything else.
