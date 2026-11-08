// The update runtime is this project's fingerprint (app.json `runtimeVersion`), so only
// what the binary is built from may count. docs/store-builds.md has the why.
/* global __dirname */
const path = require('node:path');

// The app config is read again for the fingerprint. A local .env never reaches EAS Build
// (gitignored) nor `eas update`, so it must not count on a laptop running `eas build` either.
process.env.EXPO_NO_DOTENV = '1';

/** @type {import('expo/fingerprint').Config} */
module.exports = {
  // Scripts and .gitignore change with tooling; `extra` rides in every update's manifest.
  sourceSkips: ['PackageJsonScriptsAll', 'GitIgnore', 'ExpoConfigExtraSection'],
  // app.json's `locales` (permission prompts) are built into the binary, but not counted by default.
  extraSources: [{ type: 'dir', filePath: 'locales', reasons: ['expoConfigLocales'] }],
  // EAS Build reads google-services.json from a file variable, which `eas update` never
  // downloads: counted in one and not the other, Android would never match.
  ignorePaths: process.env.GOOGLE_SERVICES_JSON
    ? [path.relative(__dirname, path.resolve(__dirname, process.env.GOOGLE_SERVICES_JSON))]
    : [],
};
