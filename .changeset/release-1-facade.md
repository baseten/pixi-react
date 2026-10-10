---
"@pixi/react": minor
---

Release 1 of the facade as 8.1.0: the upstream 8.0.x API and documented behaviour on the modular adapters (React 19.3 and Pixi 8 bundled), with the sixteen conformance-confirmed failure-path repairs. No public API change (D4).

- The React peer narrows from `>=19.0.0` to `^19.3.0`: 8.1.0 builds in React 19.3's reconciler (react-reconciler 0.34.0) and is tested with React 19.3.0. On React 19.0, 19.1 or 19.2, upgrade React, stay on 8.0.5, or compose `createRenderer` with the adapter package of your React minor (React 18: `react-18`). Another React 19 minor logs one warning.
- The Pixi code bundled is the same as 8.0.5's; the minified production bundle of the release fixture is 68.6 KiB larger (21.0 KiB gzip), reachable adapter code and react-reconciler 0.34 (issue 58).

See the migration guide (apps/docs/docs/migrating-to-8.1.mdx) and the release compatibility table (design/release-compatibility.md).
