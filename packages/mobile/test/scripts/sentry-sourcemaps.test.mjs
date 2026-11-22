import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUNDLE_IDS, uploadSourceMaps } from '../../scripts/sentry-sourcemaps.mjs';
import appConfig from '../../app.config.js';

const SETTINGS = {
  SENTRY_AUTH_TOKEN: 'sntrys_test',
  SENTRY_ORG: 'bold-video-2f64371a6',
  SENTRY_PROJECT: 'pidro-mobile',
};
const IDS = {
  ios: '019a4c1e-aaaa-7000-8000-000000000001',
  android: '019a4c1e-bbbb-7000-8000-000000000002',
};

/** What `eas update --emit-metadata` leaves in dist/, for both platforms. */
function exportDir() {
  const dist = mkdtempSync(join(tmpdir(), 'sentry-maps-'));
  writeFileSync(
    join(dist, 'eas-update-metadata.json'),
    JSON.stringify({
      updates: Object.entries(IDS).map(([platform, id]) => ({ platform, id, group: 'g1' })),
    })
  );
  for (const platform of Object.keys(IDS)) {
    const dir = join(dist, '_expo/static/js', platform);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `entry-${platform}.hbc`), 'bytecode');
    writeFileSync(
      join(dir, `entry-${platform}.hbc.map`),
      JSON.stringify({ debugId: `dbg-${platform}` })
    );
  }
  return dist;
}

describe('source maps for an update', () => {
  test('each platform goes up under the release and dist its phones report', () => {
    const dist = exportDir();
    const calls = [];
    const lines = uploadSourceMaps({
      dist,
      variant: 'beta',
      version: '3.3.0',
      env: SETTINGS,
      run: (args) => calls.push(args) && 0,
    });

    expect(calls.map((args) => args.slice(0, 7))).toEqual(
      ['ios', 'android'].map((platform) => [
        'sourcemaps',
        'upload',
        '--release',
        'com.oneapps.pidro.beta@3.3.0',
        '--dist',
        IDS[platform],
        '--debug-id-reference',
      ])
    );
    expect(calls[1].slice(7).sort()).toEqual([
      `${dist}/_expo/static/js/android/entry-android.hbc`,
      `${dist}/_expo/static/js/android/entry-android.hbc.map`,
    ]);
    const map = JSON.parse(readFileSync(`${dist}/_expo/static/js/ios/entry-ios.hbc.map`, 'utf8'));
    expect(map.debug_id).toBe('dbg-ios');
    expect(lines[0]).toContain(
      `uploaded, release \`com.oneapps.pidro.beta@3.3.0\`, dist \`${IDS.ios}\``
    );
  });

  test('without the token, org or project nothing runs and the publish goes on', () => {
    for (const name of Object.keys(SETTINGS)) {
      const calls = [];
      const lines = uploadSourceMaps({
        dist: exportDir(),
        variant: 'beta',
        version: '3.3.0',
        env: { ...SETTINGS, [name]: ' ' },
        run: (args) => calls.push(args) && 0,
      });
      expect(calls).toEqual([]);
      expect(lines).toEqual([`Source maps: not uploaded, no \`${name}\`.`]);
    }
  });

  test('a failed or crashed upload is reported, never thrown', () => {
    const attempts = [
      1,
      () => {
        throw new Error('spawn ENOENT');
      },
    ];
    const lines = uploadSourceMaps({
      dist: exportDir(),
      variant: 'beta',
      version: '3.3.0',
      env: SETTINGS,
      run: () => {
        const next = attempts.shift();
        return typeof next === 'function' ? next() : next;
      },
    });
    expect(lines).toEqual([
      'Source maps (ios): upload failed (1); the update went out regardless.',
      'Source maps (android): upload failed (Error: spawn ENOENT); the update went out regardless.',
    ]);
  });

  test('a broken export is reported, never thrown', () => {
    const run = () => 0;
    const empty = mkdtempSync(join(tmpdir(), 'sentry-maps-'));
    expect(
      uploadSourceMaps({ dist: empty, variant: 'beta', version: '3.3.0', env: SETTINGS, run })[0]
    ).toStartWith('Source maps (all): upload failed (Error: ENOENT');
    const dist = exportDir();
    writeFileSync(`${dist}/_expo/static/js/ios/entry-ios.hbc.map`, '{not json');
    expect(
      uploadSourceMaps({ dist, variant: 'beta', version: '3.3.0', env: SETTINGS, run })
    ).toEqual([
      expect.stringMatching(/^Source maps \(ios\): upload failed \(SyntaxError/),
      expect.stringMatching(/^Source maps \(android\): uploaded/),
    ]);
  });

  test('the release names the app id each variant builds with', () => {
    const env = { ...process.env };
    try {
      for (const variant of ['beta', 'production']) {
        process.env.APP_VARIANT = variant;
        process.env.EXPO_PUBLIC_ADMOB_APP_ID_IOS = 'ca-app-pub-1~1';
        process.env.EXPO_PUBLIC_ADMOB_APP_ID_ANDROID = 'ca-app-pub-1~2';
        const { ios, android } = appConfig({ config: {} });
        expect([ios.bundleIdentifier, android.package]).toEqual([
          BUNDLE_IDS[variant],
          BUNDLE_IDS[variant],
        ]);
      }
    } finally {
      process.env = env;
    }
  });
});
