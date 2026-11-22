const path = require('path');
const Module = require('module');
// Expo's defaults, plus a debug ID in every bundle so Sentry matches its source map.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const mobileModules = path.resolve(projectRoot, 'node_modules');
const mobileRequireParent = {
  id: path.join(projectRoot, 'package.json'),
  filename: path.join(projectRoot, 'package.json'),
  paths: Module._nodeModulePaths(projectRoot),
};

// NativeWind's Metro plugin is hoisted to the workspace root, where the web app
// uses Tailwind v4. Force NativeWind's own tailwindcss imports to resolve from
// mobile, which intentionally keeps Tailwind v3.
// NOTE: this hook only covers the Metro main process. NativeWind also forks a
// Tailwind CLI child process, which needs the same redirect or Metro hangs
// forever on global.css. Pass the preload to child processes with an absolute
// path; a relative NODE_OPTIONS path breaks package postinstall scripts on EAS.
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveMobileTailwind(request, parent, isMain, options) {
  if (request === 'tailwindcss' || request.startsWith('tailwindcss/')) {
    return originalResolveFilename.call(this, request, mobileRequireParent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const tailwindPreloadPath = path.resolve(projectRoot, 'scripts/tailwind-v3-resolve.cjs');
if (!process.env.NODE_OPTIONS?.includes('tailwind-v3-resolve.cjs')) {
  const preloadOption = `--require=${JSON.stringify(tailwindPreloadPath)}`;
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, preloadOption].filter(Boolean).join(' ');
}

const { withNativeWind } = require('nativewind/metro');

const config = getSentryExpoConfig(projectRoot);

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Force shared dependencies to always resolve from mobile's node_modules.
// Without this, @pidro/shared (symlinked from workspace root) resolves its
// own copies from root node_modules — causing duplicate React (hooks crash).
// Note: axios uses extraNodeModules instead of resolveRequest because
// require.resolve bypasses Metro's platform-aware resolution and picks the
// Node.js build (which needs crypto, http, etc.).
const singletonPkgs = ['react', 'react-dom', 'zustand'];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (singletonPkgs.some((pkg) => moduleName === pkg || moduleName.startsWith(pkg + '/'))) {
    try {
      const filePath = require.resolve(moduleName, { paths: [mobileModules] });
      return { type: 'sourceFile', filePath };
    } catch {
      // Fall through to default resolution
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

// For packages with platform-specific builds (like axios), use extraNodeModules
// so Metro applies its own browser/react-native resolution from the right dir.
config.resolver.extraNodeModules = {
  axios: path.resolve(mobileModules, 'axios'),
};

// Symlink + package-exports resolution are Expo defaults since SDK 53.
config.watchFolders = [workspaceRoot];

module.exports = withNativeWind(config, { input: './global.css' });
