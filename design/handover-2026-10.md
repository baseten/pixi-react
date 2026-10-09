# Handover audit and decisions (2026-10-08)

This file records the outcome of the handover audit: the open branches, PRs #21–#25, the Wave 1 (#1) and Wave 2 (#14) specs, and the historical modular prototype (React 18 / Pixi 7, 2023). It also records the owner's decisions and the amendments to the backlog that follow from them. Where this file and an issue body disagree, this file wins until the issue is updated.

## State at handover

- `main` is the upstream baseline `30cf1f8`. No modular runtime code exists yet.
- These PRs are open:

  | PR | Issue | Base |
  |---|---|---|
  | #21 | #2 | `main` |
  | #22 | #3 | `main` |
  | #23 | #4 | #22 |
  | #25 | #24 | #23 |

- GitHub Actions has never run in this fork, so none of these PRs has a CI signal. The only review so far has come from Codex.
- What was validated locally:
  - #21: the fork-safety tests pass.
  - #22 and #25: `validate.mjs` passes (44 modern tuples and 26 historical), all 661 audit tests pass, and sample tuples reproduce on Linux.
  - #23: the contract compiles under TS 5.6.3, and all 15 negative assertions fire.

## Owner decisions

| ID | Decision |
|---|---|
| D1 | The default facade imports the newest certified React 19 epoch, and its React peer range covers only that minor. The docs show how to pin an older epoch through `createRenderer`. |
| D2 | One `react-19` package with real `exports` subpaths (`/19.0`, `/19.1`, `/19.2`, `/19.3`). Each subpath bundles its exact `react-reconciler`. |
| D3 | `createRenderer` option keys are neutral: `framework` and `scene`. |
| D4 | Strict upstream parity first. The default facade behaves exactly like upstream `@pixi/react`. New APIs (`useContextBridge`, `component(Ctor)`, root error props on `Application`, `Root.status`) are exported only from the modular packages. Corrections that change behaviour (`REGISTRY_CONFLICT` on an `extend` name clash, narrower `extensions`/`PixiElements` types, rejecting changes to init-only options) are deferred to a documented future major. |
| D5 | Peer ranges cover only versions that have been certified exactly. |
| D6 | Ship both ESM and CJS with one canonical runtime instance. The mechanism is chosen in #5 or #7. |
| D7 | The audit evidence in #22 and #25 merges as-is and is not extended further. |
| D8 | Review gate: Codex review (`@codex review`). P0 and P1 findings must be fixed. Rounds that raise only P2 findings are capped at 2. After that, merge. The Claude GitHub App currently has no merge permission, so the owner merges. |
| D9 | Model mapping: `gpt-6-astra` → Claude Opus, `gpt-6.1-sol` → Claude Sonnet. |

### Later rulings (2026-10-09)

- **D3 reversed (#44).** The `createRenderer` keys are `react` and `pixi`. Renames:

  | Old | New |
  |---|---|
  | `FrameworkAdapter` | `ReactAdapter` |
  | `SceneAdapter` | `PixiAdapter` |
  | `SceneSession` | `PixiSession` |
  | `SceneTypes` | `PixiTypes` |
  | `SceneBridge` | `PixiBridge` |
  | `BindingFamily` | `ReactBindingFamily` |
  | `scene.*` capabilities | `pixi.*` |
  | `framework.react-19` / `framework.react-18` | `react.19` / `react.18` |

  There are no aliases.
- **D4.** Failure-path repairs are approved.
- **D8.** Claude merges after the Codex gate.
- **D10.** Multiple React or Pixi versions in one app are not supported unless the support is trivial.
- **Release 1 (#43).** The `@pixi/react` facade bundles its adapters (core, renderer, react-19/19.3, pixi-8). It ships separate production and development builds, and only `react`, `react-dom` and `pixi.js` are external. The modular packages are published later (#15/#40).

Merge order: #21 first, then the owner enables GitHub Actions, then #22 → #23 → #25. Use merge commits so the stacked ancestry is preserved.

## Historical prototype: findings

The prototype confirms the core design: a neutral wiring function plus a thin facade that does the default composition. Its reconciler was bundled into the React package, and D2 adopts that.

It failed in several ways, and the new design must not repeat them:

1. Nothing proved the seams. There was no second React or Pixi implementation, and no suite ran against more than one combination.
2. Its supposedly "neutral" core types were shaped around React 18 (`MinimalHostConfig`), and real Pixi classes were constrained against hand-written shapes.
3. It required five explicit generics at the composition call instead of inferring them.
4. Its published types package was broken: a devDependency only, shipping raw `.ts`, with no version.
5. It used legacy roots (`createContainer` with one argument) and had no context bridge.
6. It stored per-node state as expando properties on Pixi objects, kept registry checks behind dev-only `invariant`, and had a host-config update-payload bug caused by shared closure state.

Ideas to reuse:

- **Test harness.** Rebuild the composition with spies (`test/__utils__/configure.ts`) to get the binding interface used in #6.
- **Reference scenarios.** Use the attach and Suspense hide/unhide tests.
- **Render-on-demand signalling.** Keep it as a future optional capability. It is out of scope for Wave 1.

## Amendments by issue

### #2
- "Name the pnpm workflow after migration" moves to #5.

### #4 (must land in PR #23 before merge)
- Record D1–D6 in `adapter-architecture.md` and `compatibility.md`.
- Fix the type mapping in `contract/pixi-8.d.ts`. Text, BitmapText, HTMLText, TilingSprite, BlurFilter, custom classes with no-argument constructors, and Container children currently fail. Reuse upstream's `ConstructorOverrides`, `OmitKeys` and `PixiReactElementProps` patterns, and add a positive probe for each of these cases.
- Add a `test:contract` script that runs on TS 5.6.3 under both NodeNext and Bundler resolution.
- Give node construction and destruction a single owner, either `NodeDefinition` or `SceneSession`. Construction receives the session/app context, and destroy receives options.
- Specify how `component(Ctor)` derives a stable type name.
- Add these rules:
  - Core types never mirror `react-reconciler` signatures.
  - Registry checks throw in production.
  - Per-node state lives in a WeakMap.
- Record that reconcilers 0.33 and 0.34 treat `createContainer` argument 10 as `onDefaultTransitionIndicator`. Add an obligation to test this for the 19.2 and 19.3 root factories.

### #5
- Owns the pnpm wording in the shared AGENTS.md/CLAUDE.md guidance.
- Add `design/**` to the ESLint ignore list, or make the audit probes lint-clean. They import React 17, Pixi 6 and `@pixi/*`, none of which is installed.
- Choose the D6 single-runtime ESM/CJS mechanism, or defer it to #7 explicitly.

### #6
- Shape the adapter-binding factory on the prototype's spy-rebuild pattern.
- Add the scenarios the #3 audit missed:
  - a React 18 ConcurrentRoot, plus root error routing;
  - a context bridge from a primary React DOM renderer into the secondary Pixi renderer;
  - Pixi Application init and destroy at runtime;
  - Graphics `draw`;
  - Text updates.

### #8
- If the work exceeds one reviewable PR, amend #1 with child tickets before dispatch.
- Handle these Pixi 8 boundaries explicitly:
  - **8.5:** `Particle` is not a Container, so it needs its own node strategy using `addParticle`.
  - **8.5.0:** exclude it, because `ParticleContainer.destroy` fails; 8.5.2 fixes this.
  - **8.10:** `removeParticles()` with no end index now removes everything, so always pass explicit indices.
  - **8.7 / 8.9:** `RenderLayer` and `DOMContainer` are gated behind capabilities.
- Keep per-node state in a WeakMap, and make registry checks throw in production.

### #9
- Package the epochs as D2 describes.
- The 0.33/0.34 root factories pass `onDefaultTransitionIndicator` as argument 10. Add a test that fails if the 19.0 argument shape is reused.
- Ownership:
  - The React epoch owns the reconciler, root, host config, context bridge, and the React-side shells of `Application`, `useApplication`, `useTick` and `useExtend`.
  - All Pixi work goes through `SceneSession`.
  - The facade (#10) only composes.
- Deliver the 19.0 epoch and the subpath structure. Use child tickets for 19.1–19.3 if they don't fit in one PR.

### #10
- Apply D1 (newest epoch, narrow peer range, documented pinning) and D4 (exact upstream behaviour and exports in the facade).

### #11
- Start from upstream's `PixiReactElementProps`, `ConstructorOverrides`, `OmitKeys` and `PixiElements`, not from the contract sketch.
- Limit React 18 work to the entrypoint and type-only fixtures. Runtime React 18 fixtures move to #12.
- `PixiElements` in the facade keeps upstream's shape of covering every constructor (D4).

### #12
- Owns the runtime React 18 fixtures and the React 18 consumer type suite.
- A missing React 18-compatible its-fine is a declared capability gap with a clear runtime error. It does not block.
- Verify ConcurrentRoot and `onRecoverableError` routing.
- Possible optimisation: depend on #10 instead of #11, so #11 and #12 can run in parallel. This is not applied yet.

### #13
- Extend the #3 runner and seed manifest. The #3 seed owns the schema.
- Model: Opus.
- Branch protection for the aggregate check is an owner action.

### #24 (PR #25)
- Make `additionalTypeChecks` match the two specific its-fine exports instead of the generic "has no exported member".
- Present the claim "no core ABI expansion for React 17 / Pixi 6" as unproven until it is browser-tested.

### Wave 2 (#14–#20)

**Dependency edges**
- Add edges #16→#20 and #24→#20. The second is a soft dependency.
- Consider re-pointing #16 and #18 to #13 instead of #15.

**Scope and ownership**
- #15 and #20 conflict over whether the conformance kit is published. Resolve that.
- Drop #15's contingency for relocating the factory.
- #15 reuses the #13 harness.
- #16 owns the Pixi 7 JSX entrypoint and a v7 capability table covering:
  - `eventMode` vs `interactive`
  - the imperative Graphics API
  - Text overloads
  - `name` vs `label`
  - `view` vs `canvas`
  - `pixi.js` vs `@pixi/*`

**Clarifications**
- #17: "four cells" means four conceptual pairs.
- #18: the owner chooses the Sandpack source and the docs destination.
- #19: name the runner and pin the Playwright image.
- #20: floors follow the #3 outcome.

**Issues to create later**
- An upstream sync policy.
- An owner checklist for enabling Actions and branch protection.
- A placeholder for publication readiness.
