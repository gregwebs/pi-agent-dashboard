/** Lowest Node major whose sync `module.registerHooks` is verified against CJS interop. */
export declare const SYNC_HOOKS_MIN_MAJOR: number;

export declare function selectLoaderTier(
  mod: { registerHooks?: unknown; stripTypeScriptTypes?: unknown },
  nodeVersion?: string,
): 1 | 2 | 3;
