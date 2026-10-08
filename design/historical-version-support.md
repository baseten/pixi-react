# Historical React 17 and Pixi 6 candidates

This audit informs a later support decision. It does not implement or certify historical adapters. The production candidate floors remain React 18.3.1, Pixi 7.4.2 and Pixi 8.2.6; advertised ranges remain empty. The current upstream functionality inventory and [class architecture](adapter-architecture.md) remain the implementation baseline.

## Reproduce and interpret the evidence

[Historical seed](compatibility/historical-seed.json) enumerates published stable versions from the npm registry, exact dependencies, peer constraints and integrity hashes. [Historical evidence](compatibility/historical-evidence.json) retains installed transitive resolutions, declaration fingerprints/deltas, runtime observations and diagnostics. Raw lockfiles remain in each external tuple directory. [Tagged React source](compatibility/historical-react-source.json) and [installed ABI comparison](compatibility/historical-react-abi.json) distinguish published bundles from feature-flagged source.

Use Node 22 and npm 10, with a fresh work directory for new dependency resolution:

```sh
AUDIT_MANIFEST="$PWD/design/compatibility/historical-seed.json" AUDIT_WORKDIR=/tmp/pixi-historical-audit node design/compatibility/run.mjs
node design/compatibility/summarize.mjs /tmp/pixi-historical-audit/results.json design/compatibility/historical-evidence.json
node design/compatibility/validate.mjs --historical
node --test design/compatibility/*.test.mjs
```

The runner deliberately exits nonzero for the retained Pixi 6.4 native-ESM failures. Validation accepts only the recorded expected failures and does not convert them into certification. Installs disable lifecycle scripts; subprocesses have a three-minute bound. Each tuple uses its own dependencies, strict TS 5.6.3 consumer program and `skipLibCheck: true`. React 17's positive consumer uses Bundler resolution; a separate NodeNext check retains its known declaration failure. No production dependency is changed.

The historical source/runtime programs are observability inputs to this report and future compatibility CI. They are not production selectors. Hash changes establish changed artifacts; selected declaration changes and exercised behavior identify the boundaries described below. The original 44 modern observations and their known failures remain intact.

## React 17: one published minor, three patch pairings

| React | Reconciler | Scheduler | Reconciler React peer |
| --- | --- | --- | --- |
| 17.0.0 | 0.26.0 | 0.20.0 | ^17.0.0 |
| 17.0.1 | 0.26.1 | 0.20.1 | ^17.0.1 |
| 17.0.2 | 0.26.2 | 0.20.2 | ^17.0.2 |

There are no invented 17.1/17.2 lines. Every row is probed with each of `its-fine` 1.2.0 and 1.2.2, which declare React >=16.8. Types are pinned to `@types/react` 17.0.93 and `@types/react-reconciler` 0.26.7 because the bridge's wildcard type dependencies otherwise permit unrelated major versions. Published peers and tarballs determine these pairs: all three React tags still label the reconciler manifest 0.26.0.

The three installed reconciler bundles have distinct fingerprints but identical sets of 90 host-config keys and 37 exported methods. Those name sets match the inspected tagged custom-host and old-reconciler source. Optional hydration, persistence and test-selector keys are included; this does not make all 90 keys mandatory for a mutation renderer.

The runtime root takes `(containerInfo, tag, hydrate, hydrationCallbacks)`. `prepareUpdate` produces the payload passed to `commitUpdate(instance, payload, type, oldProps, newProps, fiber)`. Scheduler 0.20 supplies priorities and scheduling; the host uses `now` and timeout hooks. React 18/19 event-priority host hooks are absent. Event batching must use the legacy reconciler's batching/discrete-update facilities rather than assume later automatic batching. Root error callbacks from modern React are absent; class error boundaries and internal uncaught-error paths have different semantics.

All six minimal renderer runs exercise mounting, prop/state updates, host refs, layout/passive effects and cleanup, an error boundary, context updates and unmount. Context capture works from a primary source renderer to a secondary target. This models the relevant renderer roles but is not ReactDOM/browser integration. A separately exercised secondary source loses its context value: both bridge versions read `_currentValue`, while that renderer writes `_currentValue2`. This negative observation is retained. Production mode and browser bridge behavior remain untested.

The published reconciler declarations themselves disagree with the runtime: 0.26.7 declares an eight-argument root. The type fixture explicitly asserts that the runtime's four-argument call is rejected; a passing fixture does not assert that those declarations are correct. Both bridge packages re-export a directory from `dist/index.d.ts`; NodeNext fails to expose FiberProvider/useContextBridge, whereas the exact Bundler consumer passes. A future adapter needs a narrow source-backed internal reconciler interface and bridge declaration isolation or correction, followed by packed-consumer checks in both modes.

## Pixi 6 minor and patch boundaries

The baseline samples first/latest stable patches of every published minor: 6.0.0/.4, 6.1.0/.3, 6.2.0/.2, 6.3.0/.2, 6.4.0/.2 and 6.5.0/.10. The documented packaging hotfix 6.5.1 is additionally included. Optional Events is separately installed at 6.1.0, 6.3.0, 6.5.1 and 6.5.10. Optional Assets is inspected at 6.5.0/.1/.10. Optional-package evidence does not imply inclusion in the default bundle.

| Boundary | Observation and adapter consequence |
| --- | --- |
| 6.0 → 6.1 | The particle package changes from `@pixi/particles` to `@pixi/particle-container`. Public `destroyed` state/event appears; in 6.1–6.3 the event sees the flag still false. Early ownership code cannot require the later flag/event. |
| 6.1 | Federated Events becomes an optional package. Default `pixi.js` continues to expose InteractionManager/InteractionEvent. Exact optional installations exercise explicit-target capture, target, bubble and listener removal. No hit testing or renderer EventSystem installation is exercised. |
| 6.2 / 6.3 | Selected scene/ticker contracts remain usable. Some releases require browser globals at import; 6.2.0 additionally references CanvasRenderingContext2D. The 6.3.2 sample imports without the fixture. This is an import boundary, not a rendering certificate. |
| 6.4.0 / 6.4.2 | Both native-ESM runs fail with `isMobileCall is not a function` on Node 22.17.1. 6.4.0 swaps its import/require exports entries. 6.4.2 fixes that map and CommonJS works, while native ESM still fails. Installed destroy source moves the flag assignment before the event; that source fact is distinguished from a passing ESM runtime. |
| 6.4.2 → 6.5.0 | Extensions registration and generic `Container<T>` declarations appear. Optional Assets provides Promise-based asset loading alongside the legacy Loader. Spritesheet parsing adds a Promise return while retaining a deprecated callback overload; this is not wholesale removal of callback support. |
| 6.5.0 → 6.5.1 | The published 6.5.0 ticker CJS/ESM bundles embed BaseTexture, Texture and Renderer implementations. The inspected 6.5.1/.10 bundles do not. Preserve 6.5.0 as a packaging exclusion even though the limited scene program succeeds. |

The runtime records unmodified import results before installing an explicit import-only fixture: self/window aliases, a minimal canvas fill stub and, where required, a context class. WebGL contexts are null. This only bypasses eager white-texture creation to inspect scene objects. It provides no evidence of browser rendering, Text rasterization, WebGL/WebGPU, resize events or asset decoding.

Successful baseline runs exercise Container/Sprite construction, parenting/order/removal, point/scalar properties, emitter registration/removal, manual ticker updates, Sprite-based particles and destruction. The ticker callback receives numeric deltaTime. Application is synchronous, with constructor options and resize/destroy/plugin signatures inspected in actual declarations. Application construction and real renderer disposal remain browser obligations. CanvasRenderer, modern Particle and v8-only capabilities are absent from the tested default exports.

The [6.5.0 warning](https://github.com/pixijs/pixijs/releases/tag/v6.5.0) and [6.5.1 hotfix](https://github.com/pixijs/pixijs/releases/tag/v6.5.1) are upstream reports, separate from our reproduced behavior. The installed graph contains one core package at the tuple version; duplication exists inside the ticker bundle. Its CJS file shrinks from 583,728 bytes at 6.5.0 to 26,811 at 6.5.1. The audit confirms those embedded definitions, not every resulting rendering failure or the uninstalled canvas packages mentioned upstream.

## Adapter feasibility and follow-up effort

The neutral `FrameworkAdapter`, `SceneAdapter` and session contracts can represent these differences with no core ABI expansion identified by static contract review; this remains unproven until a browser-tested React 17 / Pixi 6 adapter exercises it. A separately typed React17 binding family should reject modern root error callbacks, identifierPrefix, ref-as-prop, callback-ref cleanup and unsupported React features. Four-argument roots, payload updates, scheduling and batching stay inside that adapter. Use React17 JSX/ref declarations and forwardRef for its local Application surface.

A Pixi6 adapter can translate synchronous Application construction into the existing asynchronous create/dispose lifecycle and supply numeric ticker/event/constructor types. It needs explicit ownership state across destroyed-event epochs, legacy Text constructors, Sprite particles, point setters, plugin registration and resource ownership. Legacy interaction and optional federated events must remain distinct capabilities. Optional shared Assets needs its own install/ownership policy; the default bundle cannot promise it. Internal minor branches or separate adapter epochs should be chosen by the final browser evidence, not by package major alone.

A sensible first historical implementation candidate is React17.0.2/reconciler0.26.2 with Pixi6.5.10, subject to explicit authorization. Earlier sampled minors remain separate candidates; 6.4's module-path failures and 6.5.0 packaging issue prevent a broad `^6` promise. Third parties can use the same open binding/adapter contracts, but they need their own declared ranges and certification evidence.

Expected work is comparable to another React reconciler epoch plus a legacy Pixi adapter, followed by the existing conformance/packed-consumer/browser suites. Add dedicated tests for primary-source context updates in development and production, batching and error boundaries, refs/effects, async initialization/unmount races, renderer resize/disposal, actual pointer propagation/hit testing, asset ownership, particles and visual output. This audit reduces uncertainty about those tasks; it does not complete them or change the current implementation backlog's floors.
