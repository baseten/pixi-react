# Installed version audit

This directory is an input to the adapter-design and compatibility-CI work, not a package support declaration. See [the report](../version-support.md).

Run with Node 22 and npm 10 (network access required):

```sh
node design/compatibility/validate.mjs
AUDIT_WORKDIR=/tmp/pixi-version-audit AUDIT_NPM_CACHE=/tmp/pixi-audit-cache node design/compatibility/run.mjs
```

An optional positional substring selects tuple IDs, for example `react-19.2` or `pixi-8.22`. Use a fresh `AUDIT_WORKDIR` to eliminate previous transitive resolutions. Each tuple has its own package tree and TypeScript program; React majors, JSX augmentations, and Pixi declarations cannot leak between tuples. Installs disable lifecycle scripts. Each subprocess has a three-minute bound. The runner exits nonzero on install/runtime/type failure and retains diagnostics and exact resolved locks in `results.json`; a failure never becomes a support claim. Do not put temporary installs into the repository.

`seed.json` holds exact direct package versions, registry integrity/source metadata, complete resolved-package digests, candidate epochs, and promotion requirements. `evidence.json` is a compact checked-in observation from this run. Its consumer is the report and future CI selector; no production package reads it. `advertisedRanges` is deliberately empty. Runtime capability results are observations, never automatic permission to widen a peer range.

The React probe uses a tiny in-memory mutation renderer: actual reconciler root creation, prop update, unmount, context propagation across two roots through `its-fine`, error delivery, and Activity visibility where available. It is not the production Pixi renderer or a React DOM bridge test. The Pixi probe exercises installed scene mutation, ticker argument shape, event emitter registration, destruction, and selected behavior changes without initializing a GPU. Its emitter check does not test hit testing, event capture/bubbling, rendering, or browser lifecycle.

The TypeScript consumer uses `skipLibCheck: true` to isolate consumer assignability from unrelated dependency declarations; full dependency declaration correctness is not claimed. TS 5.6.3 is pinned. No TS 6/7 certificate follows from the Pixi 8.21 release notes. Installed package source/declaration fingerprints and selected signatures support boundary comparison; changed hashes alone do not mean a breaking interface.

To refresh compact evidence after running the probes:

```sh
node design/compatibility/summarize.mjs /tmp/pixi-version-audit/results.json design/compatibility/evidence.json
node design/compatibility/validate.mjs
```

Each seed tuple pins `resolvedPackagesSha256` from its retained raw lock, independently of the compact evidence. The digest is SHA-256 of UTF-8 JSON containing `[packagePath, version, integrity]` arrays, sorted by the full package path with JavaScript's default string sort. The lock root is excluded and only the leading `node_modules/` is removed; scoped names and nested dependency paths remain intact. Validation compares the entire resolved map, including transitive packages and expected runtime failures. Package/property insertion order does not affect the digest.

When intentionally accepting new dependency resolutions, regenerate each seed tuple's digest from its new raw `row.lock` using `resolvedPackagesSha256(resolvedPackagesFromLock(row.lock))` from `resolved-packages.mjs`, then summarize and validate that same raw run. Review the lock changes before updating these expected digests; deriving them from compact evidence would remove the independent completeness check. The checked-in digests were pinned from the retained 44-tuple lock snapshots, with the compact maps checked against those snapshots.

Each tuple also pins `surfacesSha256` from the selected raw surface captures. This digest covers sorted `[path, sha256, declarations-or-null]` arrays, including declaration order. Refresh it from the raw capture using the same retained-path filter and `surfaceMapSha256` from `surface-map.mjs`; verify the captured hashes against the installed files before accepting changed metadata. The compact evidence is compared against that independently pinned digest, including known runtime failures.

Failed installs retain their exit status, signal, spawn error, and output in `installDiagnostics`; runtime and type exits are `null` because those probes did not run. Such rows do not participate in boundary deltas and do not pass validation. Each known failure declares its expected runtime exit; a negative observation inside a successful probe also names its observation path, whose status and diagnostic signature must match. Run the audit-tool regression fixtures without network access with `node --test design/compatibility/*.test.mjs`.

The runner records each tuple's canonical `workdir` in raw results. Summarization replaces that directory in diagnostic paths and file URLs with `<tuple>/`, including copied probes and dependency files. Older raw results without `workdir` must be summarized from their original audit directory so the tuple path can be derived from the input location.

For local probe development only, `AUDIT_REUSE_INSTALL=1` reuses a tuple whose installed direct versions still exactly match the seed. The retained lock records the reused transitive graph. The default remains a normal isolated install; a fresh work directory is required when auditing dependency-resolution changes. `tagged-react-surfaces.json` additionally records source fetched from each cited Git tag, rather than treating the published bundle and a feature-flagged source fork as identical.
