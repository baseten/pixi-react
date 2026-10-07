# Version support audit

Snapshot: 2026-10-07. Implementation issue: https://github.com/baseten/pixi-react/issues/3. Frozen upstream functionality base: `30cf1f86a590a1d8bb183a36b1887fa30e908d4e`.

## Decision and meaning of support

Keep the initial certification floors React **18.3.1**, Pixi **7.4.2**, and modern Pixi **8.2.6**. These are candidate certification targets. This audit does not certify a production adapter or widen advertised peer ranges. The frozen upstream feature baseline and modern dependency support are separate deliverables. The baseline package pins reconciler 0.31.0 and Pixi 8.2.6, uses React 19 types, and declares React >=19.0.0; that broad peer declaration is not evidence that later reconciler interfaces work.

Fresh registry metadata reports React **19.3.0**, reconciler **0.34.0**, and Pixi **8.22.0** as stable latest. [React's versions page](https://react.dev/versions) agrees with React 19.3; [Pixi's versions page](https://pixijs.com/versions) still says 8.21.0. The [8.22.0 tagged release](https://github.com/pixijs/pixijs/releases/tag/v8.22.0) and [npm metadata](https://registry.npmjs.org/pixi.js/8.22.0) agree on the newer Pixi release. The registry's legacy tag is 7.4.3, while the documentation page says 7.4.2. Preserve 7.4.2 as the accepted minimum; retain only the 7.4 patch line, with 7.4.3 a patch-promotion candidate rather than silently moving the floor.

React 16.14/17 final patch lines and older Pixi 7 minor epochs are future extensions, excluded from the initial advertised set. Fiber started in React 16.0 and hooks in 16.8 ([React history](https://react.dev/versions)); those facts explain possible extension work, not support. React <=17, Pixi <=6, canary/experimental React, and unvalidated backends are excluded.

## Evidence contract

The machine-readable [seed](compatibility/seed.json), [reproduction instructions](compatibility/README.md), and installed probes separate package metadata, source-level interface observations, and limited runtime/type evidence. No browser matrix or production adapter is implemented here. Every tuple remains `not-certified` until the later implementation and browser gates establish its advertised behavior.
