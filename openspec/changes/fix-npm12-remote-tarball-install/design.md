# Design — removing the remote-tarball dependency

## Constraint that killed the obvious fixes

Two candidates are ruled out by the failure mode itself, before any preference:

- **Keep the tarball, document an override.** npm has `npm_config_allow_remote=all`,
  but pnpm's equivalent (`blockExoticSubdeps`) is readable *only* from
  `pnpm-workspace.yaml`. A consumer running `pnpm install -g` has no workspace
  file, so the only escape hatch is a per-command flag
  (`--config.block-exotic-subdeps=false`) that a user must remember forever.
  Tested and rejected: `block-exotic-subdeps=false` in `~/.npmrc` and
  `pnpm config set --global blockExoticSubdeps false` (writes
  `~/Library/Preferences/pnpm/config.yaml`) — neither changes resolution
  (pnpm 11.15.1 and 12.9.1, `pnpm install --lockfile-only` on a manifest whose
  only dep is the published server tarball: still `ERR_PNPM_EXOTIC_SUBDEP`).
- **Downgrade to registry `xlsx@0.18.5`.** Carries CVE-2023-30533 (prototype
  pollution) and CVE-2024-22363 (ReDoS), which is exactly what the CDN pin
  existed to avoid; `office-preview.test.ts:202` (E71) asserts the loaded
  version is `>= 0.20.2` and would fail.

## Options weighed

| Option | Consumer install | Parser identical? | Cost |
|---|---|---|---|
| Registry alias `npm:@e965/xlsx@0.20.3` | plain `pnpm add -g`, plain `npm install -g` on npm 12 | **yes** — verified byte-level | trusts a third-party republisher for *provenance*; we verified contents, not publisher intent |
| Vendor the official 0.20.3 build into `packages/server` | plain installs | yes, trivially | ~1.5 MB of vendored third-party source in the repo and in every published tarball; manual refresh path on SheetJS releases |
| New registry-hosted parser | plain installs | **no** — different parser, new behaviour risks on untrusted input | re-does the ingestion hardening of `harden-untrusted-content-ingestion` |
| Optional lazily-installed capability | plain installs | yes | new runtime install path, new failure mode when absent; larger surface than the bug |

Chosen: **registry alias**. It is the only option that fixes both installers,
keeps the exact parser build, and adds no runtime machinery.

## Verification (the standard this change is held to)

A repo-local green install proves nothing here — the repo sets
`blockExoticSubdeps: false` and has a lockfile, which is precisely the
configuration a consumer does not have. The evidence used instead:

1. **Same code, not just same version.** `diff -rq` between the unpacked
   `cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` and `@e965/xlsx@0.20.3`:
   only `README.md` and `package.json` differ. Every `.js` / `.mjs` / `.d.ts`
   file matches.
2. **Consumer failure reproduced, then removed.** `pnpm install --lockfile-only`
   against a manifest depending on the published
   `@blackbelt-technology/pi-dashboard-server@0.9.0` fails with
   `ERR_PNPM_EXOTIC_SUBDEP` on pnpm 11.15.1 and 12.9.1 (0.10.0 publishes the
   same specifier, so it fails identically). `npm pack` of the
   patched server, then `npm@12 install --package-lock-only --allow-remote=none`:
   746 lock entries resolve, `node_modules/xlsx` is `0.20.3` from
   `registry.npmjs.org/@e965/xlsx`, and the only non-registry resolution left is
   the local `file:` self-reference of the test harness.
3. **Runtime unchanged.** `import("xlsx").version === "0.20.3"` from
   `packages/server`; E71 in `office-preview.test.ts` still passes.
4. **Regression gate bites.** `checkRegistrySpecifiers()` returns the `xlsx`
   violation on the pre-change tree and `[]` after; fixture tests cover a URL
   tarball, `git+https:`, `github:`, `git@host:` (scp form — a gap the fixture
   test caught), an `npm:` alias, a registry range, workspace protocols, private
   manifests and `devDependencies`.

## Why a manifest gate rather than a packed-install CI job

The stub proposed "a packed-install check that fails on any remote-tarball or
git dependency". `npm pack` does not rewrite dependency fields, so the packed
manifest is the source manifest; checking the source manifest over every
non-private workspace (root included) is the same signal without a network
install in CI. The check runs inside `verify-release-deps.mjs`, which `ci.yml`
already executes, and a fixture test asserts it names the manifest and field.
`--allow-remote=all` stays in place for the Electron stager for an unrelated
reason (the release lock's `bundleDependencies` tarball resolutions), so no
defence-in-depth is lost there.

## Residual risk

- The alias moves trust from `cdn.sheetjs.com` to the `@e965` republisher for
  future version bumps. Any bump must repeat the byte-level comparison before
  the version pin moves; the E71 floor keeps the version honest but not the
  content. Recording it here so the next bump is not a blind range edit.
- `@e965/xlsx` could disappear from the registry. The consequence is a failed
  install with a plain `404`, not a silent runtime fault; the vendoring option
  above stays the fallback.
