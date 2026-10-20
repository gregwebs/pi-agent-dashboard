# Consumer installs must not depend on a remote tarball

## Why

`npm install -g @blackbelt-technology/pi-agent-dashboard` and
`npx @blackbelt-technology/pi-agent-dashboard@latest` fail on npm 12 with
`EALLOWREMOTE`. `pnpm add -g @blackbelt-technology/pi-agent-dashboard` fails on
pnpm 11 and 12 with `ERR_PNPM_EXOTIC_SUBDEP`:

```
× adding a new package
╰─▶ Failed to resolve dependency tree: Exotic dependency "xlsx" (resolved via url)
    is not allowed in subdependencies when blockExoticSubdeps is enabled
```

One cause, two installers: `packages/server/package.json` depended on
`"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`, a URL tarball
rather than a registry package. From a `-g` install that dep is transitive, so
both installers' defaults reject it:

| Installer | Default | Error | Can the consumer override it? |
|---|---|---|---|
| npm 12 | `allow-remote=none` | `EALLOWREMOTE` | yes — `npm_config_allow_remote=all` |
| pnpm 11 / 12 | `blockExoticSubdeps=true` | `ERR_PNPM_EXOTIC_SUBDEP` | only via a command flag: `--config.block-exotic-subdeps=false`. `~/.npmrc` and `pnpm config set --global` are both ignored — pnpm reads this key only from `pnpm-workspace.yaml`, which a `-g` install has none of. |

Reproduced 2026-10-12 with npm 12.0.2, and again 2026-10-18 with pnpm 11.15.1
and 12.9.1 against the published `@blackbelt-technology/pi-dashboard-server@0.9.0`
tarball (both installers fail; both succeed with their respective override).
0.10.0, the current release, ships the identical specifier — `develop` still
pins the CDN tarball — so the same workaround applies to it.

The documented "install without Electron" path (`docs/faq.md`) and the README
install line are therefore broken for every user on a current npm, and for
every pnpm user regardless of version.

## What Changes

- **Replace the URL tarball with a registry alias.**
  `packages/server/package.json` now declares
  `"xlsx": "npm:@e965/xlsx@0.20.3"`. `@e965/xlsx@0.20.3` is a registry repack of
  the same official SheetJS 0.20.3 build: `diff -rq` over the unpacked trees
  shows every JS/MJS/`.d.ts` file byte-identical, only `package.json` and
  `README.md` differ. The version pin that `office-preview.test.ts` (E71,
  `>= 0.20.2` for CVE-2023-30533 / CVE-2024-22363) asserts is unchanged, and
  `import * as XLSX from "xlsx"` still resolves — an alias installs under the
  aliased name.
- **Gate the whole class at the manifest level.**
  `scripts/verify-release-deps.mjs` gains `checkRegistrySpecifiers()`: any
  `https:`/`http:`/`git:`/`git+ssh:`/`github:`/`codeload:`/`git@host:` specifier
  in a consumer-installed runtime field (`dependencies`,
  `peerDependencies`, `optionalDependencies`) of a non-private manifest fails
  the pre-release gate (`collectFailures()`, run by `ci.yml`). `npm:` aliases,
  registry ranges and the workspace protocols pass. Private manifests and
  `devDependencies` are skipped — consumers install neither.
- **Remove the now-unnecessary npm override** from the Claude plugin bootstrap
  (`packages/claude-plugin/skills/pi-dashboard-bootstrap/scripts/ensure-dashboard.sh`):
  `npm_config_allow_remote=all` is gone from both the `install -g` and the
  `npm exec` calls. The `unset npm_config_allow_remote` at the top stays: a
  caller-exported override must still never reach a server we start (design D4,
  asserted by E24b).
- **Keep `--allow-remote=all` in the Electron runtime stager**, with a corrected
  rationale: the staged lock is generated with that flag for
  `bundleDependencies` tarball resolutions (`@tailwindcss/oxide-wasm32-wasi`),
  which is a different reason than the removed `xlsx` tarball. Comments in
  `runtime-stager.ts`, its test and `runtime-overlay/AGENTS.md` said otherwise;
  they now describe the actual reason.
- **Docs**: `docs/faq.md` gains the pnpm install path plus the workaround that
  works on the already-released 0.9.0 (and the two that look like they should
  work but do not); the README install area gets the one-line note.

## Capabilities

### Modified Capabilities

None. Spreadsheet preview (`.xlsx`/`.csv` → `"spreadsheet"`, `GET /api/file/sheet`)
behaves identically: same parser version, same 0.20.3 build, byte-identical code.
`file-and-url-preview` needs no delta.

## Impact

- `packages/server/package.json` — the dependency; `pnpm-lock.yaml` regenerated
  (one package entry swapped for the alias; 746-entry published tree unchanged
  otherwise).
- `packages/server/src/lib/office-preview.ts` — the lazy `import("xlsx")` is
  untouched and still resolves.
- `scripts/verify-release-deps.mjs` + `scripts/__tests__/dependency-declarations.test.mjs`
  — the new gate and its fixture/set-based tests.
- `packages/claude-plugin/skills/pi-dashboard-bootstrap/scripts/ensure-dashboard.sh`
  + `scripts/__tests__/claude-plugin-ensure-dashboard.test.mjs` (E24, X8
  expectations).
- Stale comments naming the tarball: `runtime-stager.ts`,
  `runtime-stager.test.ts`, `runtime-overlay/AGENTS.md`,
  `publish-version-step-contract.test.ts`.
- No behaviour change for existing installs; no migration. Users on 0.9.0 and
  0.10.0 keep the documented workaround until the fix ships.

## Discipline Skills

- `security-hardening`: the swap replaces a document parser that handles
  untrusted spreadsheets, so the substitute had to be verified as the same code,
  not merely the same version number (done: byte-level `diff -rq` against the
  official CDN tarball; the only differences are metadata and README).
- `doubt-driven-review`: the change alters the published install surface for
  every user, and the verification standard is "a packed install resolves under
  the installers' strictest defaults", not "the repo's own install is green".
