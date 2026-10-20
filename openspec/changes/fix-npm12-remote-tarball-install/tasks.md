# Tasks

## 1. Regression gate first (red before green)

- [x] 1.1 Add `checkRegistrySpecifiers(manifests)` + `EXOTIC_SPECIFIER` to
  `scripts/verify-release-deps.mjs`: one failure per URL/git specifier in a
  consumer-installed runtime field (`dependencies`, `peerDependencies`,
  `optionalDependencies`) of a non-private manifest, naming manifest, field and
  dep. `npm:` aliases pass; private manifests and `devDependencies` are skipped.
- [x] 1.2 Wire it into `collectFailures()` so `ci.yml`'s
  `node scripts/verify-release-deps.mjs` step fails on the next exotic dep.
- [x] 1.3 Tests in `scripts/__tests__/dependency-declarations.test.mjs`: URL
  tarball, `git+https:`, `github:`, `git@host:` (scp form), `npm:` alias,
  registry range, workspace protocols, private manifest, `devDependencies`, the
  real tree, and `collectFailures` wiring. Fixture test caught the missing
  `git@host:` form — a real gap in the first regex.
- [x] 1.4 Red before the swap: `checkRegistrySpecifiers(piManifests())` reported
  exactly one violation —
  `packages/server/package.json dependencies.xlsx="https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`.

## 2. Dependency swap

- [x] 2.1 Verify the substitute is the same code, not merely the same version:
  `diff -rq` between the unpacked CDN tarball and `@e965/xlsx@0.20.3` —
  only `README.md` and `package.json` differ.
- [x] 2.2 `packages/server/package.json`: `"xlsx": "npm:@e965/xlsx@0.20.3"`
  (exact pin, matching the previous pin's rigidity; E71 keeps the `>= 0.20.2`
  floor honest).
- [x] 2.3 Regenerate `pnpm-lock.yaml` with the pinned `pnpm@11.15.1`: one alias
  package entry added, the tarball entry removed, nothing else moves.
- [x] 2.4 `import("xlsx").version === "0.20.3"` from `packages/server`;
  `office-preview.test.ts` (E71) and `file-raw-render-endpoints.test.ts` pass.
- [x] 2.5 Allow `npm:` alias ranges in the existing "no NEW unsatisfiable range"
  test (`semverRangeOf()` strips the alias down to its own range) instead of
  widening the `https:` skip that existed only for this dep.

## 3. Consumer-install verification (the actual requirement)

- [x] 3.1 Reproduce the consumer failure: `pnpm install --lockfile-only` on a
  manifest depending on the published server `0.9.0` → `ERR_PNPM_EXOTIC_SUBDEP`
  on pnpm 11.15.1 **and** 12.9.1.
- [x] 3.2 Confirm the workaround to document is the only one that works: the
  `--config.block-exotic-subdeps=false` command flag resolves (exit 0);
  `~/.npmrc` (`block-exotic-subdeps` and `blockExoticSubdeps`) and
  `pnpm config set --global` do not.
- [x] 3.3 Post-fix gate: `npm pack` the patched server, then
  `npm@12 install --package-lock-only --allow-remote=none` → 746 entries
  resolve; `node_modules/xlsx` = `0.20.3` from
  `registry.npmjs.org/@e965/xlsx`; no non-registry entry except the harness's
  own `file:` self-reference.

## 4. Remove the workaround the fix retires

- [x] 4.1 `ensure-dashboard.sh`: drop `npm_config_allow_remote=all` from the
  `install -g` and `npm exec` calls. Keep `unset npm_config_allow_remote` — a
  caller-exported override must never reach a server we start (design D4).
- [x] 4.2 Update `claude-plugin-ensure-dashboard.test.mjs` E24 / X8 to expect a
  plain invocation (`allowRemote === ""`); E24b still proves the `unset`.
- [x] 4.3 Keep `--allow-remote=all` in `runtime-stager.ts` for its *real*
  reason (release-lock `bundleDependencies` tarballs, e.g.
  `@tailwindcss/oxide-wasm32-wasi`), and correct the comments that named the
  removed `xlsx` tarball: `runtime-stager.ts`, `runtime-stager.test.ts`,
  `runtime-overlay/AGENTS.md`, `publish-version-step-contract.test.ts`.

## 5. Docs

- [x] 5.1 `docs/faq.md`: pnpm install path, the 0.9.0 `ERR_PNPM_EXOTIC_SUBDEP`
  symptom, the one working workaround, and the two that do not work.
- [x] 5.2 README install area: one-line pnpm note.
- [x] 5.3 `CHANGELOG.md` under `[Unreleased]`.

## 6. Verification

- [x] 6.1 Targeted suites green: `dependency-declarations.test.mjs`,
  `office-preview.test.ts`, `runtime-stager.test.ts`,
  `file-raw-render-endpoints.test.ts`, `publish-version-step-contract.test.ts`,
  `claude-plugin-ensure-dashboard.test.mjs`.
- [x] 6.2 Full `npm test` run on this machine: 278 failures, all pre-existing and
  environmental — Node v23.11.0 here vs Node 24 in CI. Two signatures only:
  `Error: no such module: fts5` (`node:sqlite` built without FTS5 → every
  `kb` / `memory-eval` / `kb-extension` suite) and `Error: Path is a directory`
  from `fs.rmSync(symlink)` (`rmSync` symlink semantics differ → `grant-layer`,
  `folder-commands-route`, and the other symlink tests). None of the failing
  files is touched by this change; the touched suites in 6.1 are green.
- [x] 6.3 Repo-wide typecheck (`npm run lint` → `scripts/tsc7.mjs --noEmit`) fails
  only on `packages/dashboard-plugin-runtime/src/__tests__/slot-claims-invalidation.tsx`
  (`Promise.withResolvers` vs the package's `lib` target) — identical at HEAD,
  untouched here. `biome check` on the touched files is clean apart from
  pre-existing warnings.

## 7. Deliberately not done

- [ ] 7.1 A dedicated packed-install CI job. Not needed for the signal: `npm pack`
  does not rewrite dependency fields, so the packed manifest equals the source
  manifest, and the manifest gate in §1 runs in `ci.yml` already. The packed
  *resolution* proof in 3.3 stays a manual pre-release step until a real
  consumer-side regression is observed. Rationale recorded in `design.md`.
- [ ] 7.2 Pinning `@e965/xlsx` by content instead of by version. The next
  version bump must repeat the byte-level comparison (residual risk in
  `design.md`); no mechanism enforces it yet.
