// Pure tier selector for the Node-native TypeScript loader (design D4). No side
// effects, so tests can import it with a stubbed `node:module`.
//
//   tier 1: registerHooks + stripTypeScriptTypes   (Node >= 24)      sync, in-thread
//   tier 2: register      + stripTypeScriptTypes   (22.19+ / 23.x)   async, off-thread
//   tier 3: register      + bundled amaro          (23.0-23.1)       no native stripper
//
// TIER 1 IS MAJOR-GATED, not just API-gated: on Node 23.11.0 the sync in-thread
// hooks corrupt CommonJS interop for the whole process — a CJS dependency doing
// `require('semver')` / `require('glob')` gets a module object without its own
// exports, so the server dies before it binds a port:
//
//   TypeError: semver.satisfies is not a function
//     at jsonwebtoken/lib/asymmetricKeyDetailsSupported.js:3
//   TypeError: Cannot read properties of undefined (reading 'exports')
//     at @fastify/static/index.js:12            (published global install)
//
// Same loader logic on Node 26.12.0 boots clean. The failure is therefore a
// property of the NODE, not of our hooks, and no hook-side change can detect or
// undo it (registerHooks has no unregister). Node 23.x consequently keeps the
// off-thread `module.register` tier that 0.9.0 shipped and that is known-good
// there — which is also why 0.9.0 booted on the affected machine and 0.10.0
// did not. Deleting `module.registerHooks` from `node:module` reproduces the
// fallback in tests (test-plan E1).
//
// See changes: strip-only-native-ts-loader, fix-node23-sync-hooks-cjs-interop.

/** Lowest major whose sync `module.registerHooks` is verified against CJS interop. */
export const SYNC_HOOKS_MIN_MAJOR = 24;

/** Major version of a `process.version`-shaped string, or `0` when unparseable. */
function majorOf(version) {
  const m = /^v?(\d+)\./.exec(String(version ?? ""));
  return m ? Number(m[1]) : 0;
}

/**
 * @param {{ registerHooks?: unknown, stripTypeScriptTypes?: unknown }} mod
 * @param {string} [nodeVersion] defaults to `process.version`
 * @returns {1 | 2 | 3}
 */
export function selectLoaderTier(mod, nodeVersion = process.version) {
  const hasHooks = typeof mod.registerHooks === "function" && majorOf(nodeVersion) >= SYNC_HOOKS_MIN_MAJOR;
  const hasStrip = typeof mod.stripTypeScriptTypes === "function";
  if (hasHooks && hasStrip) return 1;
  if (hasStrip) return 2;
  return 3;
}
