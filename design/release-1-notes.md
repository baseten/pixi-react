# Release 1 notes (draft)

Draft release notes for Release 1 ([issue 40](https://github.com/baseten/pixi-react/issues/40)). Nothing is
published: the owner publishes after the approvals listed in [release.md](release.md#before-publishing-owner-approvals).
Package names are the `target` namespace of `release.packages.json` (upstream's `@pixi` scope, pending
[issue 41](https://github.com/baseten/pixi-react/issues/41)).

## `@pixi/react` 8.1.0

A drop-in replacement for `@pixi/react` 8.0.x: the same API and documented behaviour (D4), rebuilt on the modular React
and PixiJS adapters, with sixteen failure-path bugs fixed. No new API is added to `@pixi/react`; the new APIs are in
the modular packages. The migration guide is
[apps/docs/docs/migrating-to-8.1.mdx](../apps/docs/docs/migrating-to-8.1.mdx).

### Breaking for some installs: the React peer is `^19.3.0`

| | 8.0.5 | 8.1.0 |
| --- | --- | --- |
| `react` peer | `>=19.0.0` | `^19.3.0` (tested: 19.3.0) |
| `pixi.js` peer | `^8.2.6` | `>=8.2.6 <8.5.0 \|\| >=8.5.1 <8.23.0` |
| Reconciler | react-reconciler 0.31.0 (React 19.0) | react-reconciler 0.34.0 (React 19.3), its-fine 2.1.1 |

8.0.x ran React 19.0's reconciler on every React 19 minor, untested on 19.1 and later. 8.1 builds in React 19.3's
reconciler and declares that (D1, as amended by issue 49). With npm 7 or later, installing 8.1.0 next to React 19.0,
19.1 or 19.2 fails with `ERESOLVE`. Such apps can:

- upgrade React to 19.3;
- stay on `@pixi/react` 8.0.5;
- compose their own renderer: `createRenderer` from `@pixi/react-renderer` with `@pixi/react-19.0`, `-19.1` or `-19.2`
  (or `@pixi/react-18` for React 18.3.1) and `@pixi/react-pixi-8`, all at 8.1.0. The recipe is in the migration guide
  and in the facade README.

On a React 19 minor newer than 19.3, 8.1.0 installs, runs, and logs one console warning naming the tested version.

8.5.0 stays excluded from the pixi.js range (its `ParticleContainer.destroy` fails).

### Bug fixes (D4 failure-path repairs)

The sixteen defects of upstream 8.0.x that the conformance suite confirmed (recorded as the facade's expected failures
until issue 10; owners issues 7, 8 and 9) pass in 8.1.0:

| Conformance scenario | Fix |
| --- | --- |
| `destruction.nested` | Removing a node destroys its descendants (`destroy({ children: true })`). |
| `destruction.app-unmount-nested` | Unmounting `<Application>` destroys nested nodes, not only top-level ones. |
| `resources.destroy-options-transfer` | `destroyOptions` such as `texture: true` reach the children destroyed with the app. |
| `suspense.unhide-keeps-user-visibility` | Unhiding a Suspense subtree keeps a committed `visible={false}`. |
| `props.removal.required-constructor-argument` | Removing a prop from a class whose constructor needs arguments no longer throws. |
| `props.dashed.mount` | Dashed props (`position-x`) are applied on mount. |
| `Application.extensions.swap` | Swapping an extension adds the new one instead of dropping the last. |
| `Application.init.failure-no-unhandled-rejection` | A failing `init` causes no unhandled rejection. |
| `Application.init.failure-unmount` | A root whose `init` failed is released on unmount. |
| `Application.init.failure-isolated` | A failed root no longer breaks the next `Application`'s `init`. |
| `Application.init.unmount-before-init.no-late-commit` | Unmounting before `init` settles commits no late children. |
| `Application.init.unmount-before-init.no-oninit` | Unmounting before `init` settles does not call `onInit`. |
| `Application.lifecycle.strict-mode-children-after-init` | Under `StrictMode`, children commit only after `init`. |
| `createRoot.render-resolves-after-commit` | `root.render()` resolves after the commit. |
| `createRoot.unmount` | A `createRoot` root can be torn down with `root.unmount()` (the `Root` type is unchanged). |
| `createRoot.same-element` | A second `createRoot` on the same element reuses the root. |

Kept as in 8.0.x for now (deferred to a future major, D4): silent `extend` replacement, global `extensions` and
`defaultTextStyle`, `PixiElements` covering every PixiJS class, and accepting changes to init-only options.

### Bundle size

Measured on the release fixture (`scripts/release/fixtures/bundle/facade.mjs`; esbuild 0.21.5, minified, production,
pixi.js 8.22.0, React 19.3.0):

| Bundle | Minified | Gzip |
| --- | --- | --- |
| Upstream `@pixi/react` 8.0.5 | 663.6 KiB | 196.2 KiB |
| `@pixi/react` 8.1.0 | 732.2 KiB | 217.2 KiB |

The PixiJS code is identical (the same 381 pixi.js modules; issue 57). The extra 68.6 KiB (21.0 KiB gzip) is our
adapter code the app can reach (64.4 KiB, against upstream's 16.2 KiB) and react-reconciler 0.34, which React 19.3
needs (127.0 KiB, against 0.31's 112.3 KiB). [#58](https://github.com/baseten/pixi-react/issues/58) reduced the
difference from 88 KiB (27 KiB gzip) by dropping development-only diagnostics from production builds (below) and
bundling the adapter code without per-module overhead; the owner ruled that the rest does not block Release 1.

### Production error messages

Production builds (your bundler replaces `process.env.NODE_ENV` with `'production'`, as React requires) run every check
of a development build and throw the same errors, with the same codes and details. Only the diagnostic text is
development-only ([#58](https://github.com/baseten/pixi-react/issues/58)):

- A `CompatibilityError` keeps its `code`, `adapterIds`, `capability`, `expected`, `actual` and `cause`, and its
  message is built from them, for example `ABI_MISMATCH (pixi-8; expected {"major":1}; actual {"major":2,"minor":0}).
  A development build (NODE_ENV !== 'production') gives the full message.` An unregistered element
  (`UNKNOWN_ELEMENT`) keeps its full message.
- A few `TypeError`s for invalid arguments have shorter messages, such as `Invalid createRoot() target.`
- The Pixi 8 adapter's console warnings (a Pixi-named event prop such as `onpointerdown`, `draw` on a node that is not
  a Graphics, a dashed prop naming a missing field, a removed prop with no default to restore) are development-only.

Errors and warnings that 8.0.5 also produced (for example a second `createRoot` on one target, or a hook outside an
`Application`) are unchanged, as is the warning for an untested React 19 minor.

## The modular packages, 8.1.0

First release of the packages `@pixi/react` is built from. They release in lockstep with the facade: every package is
8.1.0, and the renderer and every adapter depend on `@pixi/react-core` at exactly 8.1.0. **Install all `@pixi/react-*`
packages at the same version.** Mixing versions installs a second copy of core; when the two implement different
adapter ABIs, composition fails with `CompatibilityError` (`ABI_MISMATCH`). The adapter ABI (ABI 1 in this release) is
versioned separately, in the adapter manifests: a later minor release may change it, and its changelog will say so.

| Package | For | Peer |
| --- | --- | --- |
| `@pixi/react-core` | The adapter ABI, `CompatibilityError`, base classes for third-party adapters | - |
| `@pixi/react-renderer` | `createRenderer({ react, pixi })` | - |
| `@pixi/react-19.0` … `@pixi/react-19.3` | One React 19 minor each, with its exact reconciler and its-fine | exact tested React versions |
| `@pixi/react-18` | React 18.3.1 | `react` 18.3.1 |
| `@pixi/react-pixi-8` | PixiJS 8 | the same pixi.js range as `@pixi/react` |

New APIs, available only through `createRenderer`: `useContextBridge`, `component(Ctor)`, root error callbacks on
`Application`, and `Root.status`. The exact versions each package is tested with are in the generated
[release compatibility table](release-compatibility.md).

## Tested and verified

React 19.3.0 (and each adapter's exact React versions) with pixi.js 8.2.6 and 8.22.0 run in the required PR-tier
compatibility cells on every change: these versions are **tested**. The [2026-10-10 verification record](compatibility/verification/2026-10-10.md)
ran the full nightly matrix and **verifies** every React adapter at both audited patches with every Pixi 8 minor's
newest audited patch and pixi.js 7.4.2 and 7.4.3 on **WebGL**, and with pixi.js 8.10.2 … 8.22.0 on **WebGPU**. On
WebGPU, pixi.js 8.2.6 to 8.9.2 are an expected blank render, unverified: a blank canvas on the software WebGPU adapter,
although every conformance scenario passes. The record ran on software rendering (SwiftShader, no GPU); a run on a
real GPU can be added as extra evidence. The verified tuples are `verifiedRanges` in the compatibility manifest.
Verification is evidence, not a support guarantee, and no peer range was widened ([release.md](release.md#tested-and-verified)).
