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
