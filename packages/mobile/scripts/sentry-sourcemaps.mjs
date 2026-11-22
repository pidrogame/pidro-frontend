/**
 * Uploads the source maps of an `eas update --emit-metadata` export to Sentry, so a crash
 * from that update shows our code. Used by scripts/publish-beta.mjs and ship.mjs ota.
 *
 * Release and dist are what src/bootstrap/sentry.ts reports on a phone running the
 * update: `<bundle id>@<version>` and the platform's update id. The bundle's debug ID
 * (metro.config.js) matches it to its map as well.
 *
 * An update never fails because of Sentry: without SENTRY_AUTH_TOKEN, SENTRY_ORG or
 * SENTRY_PROJECT, or when the upload fails, it says so and the publish goes on.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const SETTINGS = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'];

/** The app id each variant's phones report (app.config.js), so the release they read. */
export const BUNDLE_IDS = { beta: 'com.oneapps.pidro.beta', production: 'com.oneapps.pidro' };

/** One line per platform: uploaded, or why not. */
export function uploadSourceMaps({
  dist = 'dist',
  variant,
  version,
  env = process.env,
  run = (args) => {
    const { status, error } = spawnSync(
      createRequire(import.meta.url).resolve('@sentry/cli/bin/sentry-cli'),
      args,
      { stdio: 'inherit', env, timeout: 5 * 60_000 }
    );
    return error ?? status;
  },
}) {
  const missing = SETTINGS.filter((name) => !env[name]?.trim());
  if (missing.length) {
    console.log(`::warning::Source maps not uploaded to Sentry: no ${missing.join(', ')}`);
    return [`Source maps: not uploaded, no \`${missing.join('`, `')}\`.`];
  }

  const failed = (what, problem) => {
    console.log(`::warning::Sentry source map upload failed for ${what} (${problem})`);
    return `Source maps (${what}): upload failed (${problem}); the update went out regardless.`;
  };
  const release = `${BUNDLE_IDS[variant]}@${version}`;
  let updates;
  try {
    ({ updates } = JSON.parse(readFileSync(`${dist}/eas-update-metadata.json`, 'utf8')));
  } catch (error) {
    return [failed('all', error)];
  }
  return updates.map(({ platform, id }) => {
    try {
      const dir = `${dist}/_expo/static/js/${platform}`;
      const files = readdirSync(dir).filter((file) => /\.(hbc|js)(\.map)?$/.test(file));
      const map = files.find((file) => file.endsWith('.map'));
      if (!map) return failed(platform, 'no source map in the export');
      // sentry-cli reads the debug ID under the name Sentry's own Expo script gives it.
      const source = JSON.parse(readFileSync(`${dir}/${map}`, 'utf8'));
      if (source.debugId && !source.debug_id)
        writeFileSync(`${dir}/${map}`, JSON.stringify({ ...source, debug_id: source.debugId }));

      console.log(`Uploading ${platform} source maps to Sentry: release ${release}, dist ${id}`);
      const status = run([
        'sourcemaps',
        'upload',
        '--release',
        release,
        '--dist',
        id,
        ...(files.some((file) => file.endsWith('.hbc')) ? ['--debug-id-reference'] : []),
        ...files.map((file) => `${dir}/${file}`),
      ]);
      if (status !== 0) return failed(platform, status);
      return `Source maps (${platform}): uploaded, release \`${release}\`, dist \`${id}\`.`;
    } catch (error) {
      return failed(platform, error);
    }
  });
}
