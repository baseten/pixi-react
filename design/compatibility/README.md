# Installed version audit

This directory is an input to the adapter-design and compatibility-CI work, not a package support declaration. See [the report](../version-support.md).

Run with Node 22 and npm 10 (network access required):

```sh
node design/compatibility/validate.mjs
AUDIT_WORKDIR=/tmp/pixi-version-audit AUDIT_NPM_CACHE=/tmp/pixi-audit-cache node design/compatibility/run.mjs
```

An optional positional substring selects tuple IDs, for example `react-19.2` or `pixi-8.22`. Use a fresh `AUDIT_WORKDIR` to eliminate previous transitive resolutions. Each tuple has its own package tree and TypeScript program; React majors, JSX augmentations, and Pixi declarations cannot leak between tuples. Installs disable lifecycle scripts. Each subprocess has a three-minute bound. The runner exits nonzero on install/runtime/type failure and retains diagnostics and exact resolved locks in `results.json`; a failure never becomes a support claim. Do not put temporary installs into the repository.

`seed.json` holds exact direct package versions, registry integrity/source metadata, candidate epochs, and promotion requirements. `evidence.json` is a compact checked-in observation from this run. Its consumer is the report and future CI selector; no production package reads it. `advertisedRanges` is deliberately empty. Runtime capability results are observations, never automatic permission to widen a peer range.

The React probe uses a tiny in-memory mutation renderer: actual reconciler root creation, prop update, unmount, context propagation across two roots through `its-fine`, error delivery, and Activity visibility where available. It is not the production Pixi renderer or a React DOM bridge test. The Pixi probe exercises installed scene mutation, ticker argument shape, event emitter registration, destruction, and selected behavior changes without initializing a GPU. Its emitter check does not test hit testing, event capture/bubbling, rendering, or browser lifecycle.

The TypeScript consumer uses `skipLibCheck: true` to isolate consumer assignability from unrelated dependency declarations; full dependency declaration correctness is not claimed. TS 5.6.3 is pinned. No TS 6/7 certificate follows from the Pixi 8.21 release notes. Installed package source/declaration fingerprints and selected signatures support boundary comparison; changed hashes alone do not mean a breaking interface.

To refresh compact evidence after running the probes:

```sh
node design/compatibility/summarize.mjs /tmp/pixi-version-audit/results.json design/compatibility/evidence.json
node design/compatibility/validate.mjs
```

Failed installs retain their exit status, signal, spawn error, and output in `installDiagnostics`; runtime and type exits are `null` because those probes did not run. Such rows do not participate in boundary deltas and do not pass validation. Each known failure declares its expected runtime exit; a negative observation inside a successful probe also names its observation path, whose status and diagnostic signature must match. Run the audit-tool regression fixtures without network access with `node --test design/compatibility/*.test.mjs`.

The runner records each tuple's canonical `workdir` in raw results. Summarization replaces that directory in diagnostic paths and file URLs with `<tuple>/`, including copied probes and dependency files. Older raw results without `workdir` must be summarized from their original audit directory so the tuple path can be derived from the input location.

For local probe development only, `AUDIT_REUSE_INSTALL=1` reuses a tuple whose installed direct versions still exactly match the seed. The retained lock records the reused transitive graph. The default remains a normal isolated install; a fresh work directory is required when auditing dependency-resolution changes. `tagged-react-surfaces.json` additionally records source fetched from each cited Git tag, rather than treating the published bundle and a feature-flagged source fork as identical.

The separate [historical audit](../historical-version-support.md) uses `AUDIT_MANIFEST` to select `historical-seed.json`, with version-specific runtime/type files and explicit compiler variants. Validate it using `node design/compatibility/validate.mjs --historical`. The default manifest and modern evidence remain unchanged.

Historical Pixi tuples declare independent `pixi6-baseline`, `pixi6-federated`, and `pixi6-assets` declaration series. The runner retains this identity in raw evidence; the summary and validator compare each tuple only with the preceding installed tuple in its series, even when series are interleaved. The first tuple in each series has no preceding surface, and removed paths have `after: null`. Series identity is checked against the installed experiment's direct package selection. Modern Pixi tuples keep their existing default history and output format.
