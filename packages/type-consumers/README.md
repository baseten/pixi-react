# @pixi-react-provisional/type-consumers

TypeScript consumer fixtures for the declarations ([issue 11](https://github.com/baseten/pixi-react/issues/11)).
Private; nothing here is published.

`pnpm --filter @pixi-react-provisional/type-consumers typecheck` (part of `pnpm test:types`) runs
[`scripts/run.mjs`](scripts/run.mjs):

1. `pnpm pack` the built `core`, `renderer`, `react-19.3`, `react-18`, `pixi-8`, `pixi-7` and the `@pixi/react` facade. The `react-19.3` and facade tarballs bring their exact `react-reconciler` and `its-fine` dependencies from the registry.
2. For each cell, install a consumer **outside the repository** (`$PIXI_REACT_TYPE_CELLS`, default
   `<os tmpdir>/pixi-react-type-consumers`) with `pnpm install --ignore-workspace`: the tarballs plus exact React,
   `@types/react`, pixi.js and TypeScript from the registry. No workspace link, tsconfig path or parent
   `node_modules` is reachable.
3. Compile each fixture program under NodeNext and Bundler resolution and classic (`react`), automatic (`react-jsx`)
   and development (`react-jsxdev`) JSX, with `strict` and `skipLibCheck: false`. `.cts` files (CommonJS `require`
   consumers) compile under NodeNext only.
4. Remove each `@ts-expect-error` in turn and require an error on the line it guards.
5. Compile the `must-fail` programs and require exactly the diagnostic codes in their `expect.json`.

| Cell | React / `@types/react` | pixi.js | TypeScript | Programs |
| --- | --- | --- | --- | --- |
| `react-19-pixi-8.2.6` | 19.3.0 / 19.3.0 | 8.2.6 | 5.6.3 | `react-19` (the `react-19.3` package), `facade`, must-fail |
| `react-19-pixi-8.22.0` | 19.3.0 / 19.3.0 | 8.22.0 | 5.7.3 | `react-19` (the `react-19.3` package), `facade`, must-fail |
| `react-18-pixi-8.2.6` | 18.3.1 / 18.3.31 | 8.2.6 | 5.6.3 | `react-18`, must-fail |
| `react-18-pixi-8.22.0` | 18.3.1 / 18.3.31 | 8.22.0 | 5.7.3 | `react-18`, must-fail |
| `react-19-pixi-7.4.3` | 19.3.0 / 19.3.0 | 7.4.3 | 5.6.3 | `pixi7-react-19` (the `react-19.3` and `pixi-7` packages) |
| `react-18-pixi-7.4.2` | 18.3.1 / 18.3.31 | 7.4.2 | 5.6.3 | `pixi7-react-18` (the `react-18` and `pixi-7` packages) |

The compiler follows the pixi.js version: 8.2.6's declarations fail TypeScript 5.7's DOM types (the audit compiler
5.6.3 is used), and 8.22.0's need 5.7's generic typed arrays. React 18 cells are types only: they install `core` and
`pixi-8` and use `pixi-8/jsx/react-18`; the runtime React 18 adapter is issue 12.

| Program | Covers |
| --- | --- |
| `react-19` | `pixi-8/jsx/react-19` with a registered catalogue (`Pixi8StandardCatalog` plus a required-options and a generic custom class): props, constructor options and overrides, `draw`, refs, pointer and wheel events, children of leaves, readonly and method keys, abstract/internal/resource/unregistered tags, opt-in unprefixed tags. `createRenderer` with `React19Adapter` (19.3) and `Pixi8Adapter`: `Application` options and ref, `useTick`, `useApplication`, `createRoot`, `component(Ctor)`, `extend`/`useExtend`, `applyProps`, `ComponentsOf`. `Pixi8StandardCatalog` and `Pixi8FloorCatalog` used as core `Catalog`s (`extend`, `ComponentsOf`) with exact keys. A CommonJS consumer. Version files: later nodes and `AnimatedSpriteOptions` on 8.22.0, their absence on 8.2.6 |
| `react-18` | `pixi-8/jsx/react-18` with part of the standard catalogue registered, including the global `JSX` namespace |
| `pixi7-react-19`, `pixi7-react-18` | The Pixi 7 adapter (issue 16): `pixi-7/jsx/react-19` or `/jsx/react-18` with a registered Pixi 7 catalogue (a Container subclass with required options, a Sprite subclass): positional constructor arguments as props (required where Pixi 7 requires them), instance props, points, events, `draw` with Pixi 7's imperative Graphics API, a shared `geometry`, leaves (filters, BitmapText). `createRenderer` with the React adapter and `Pixi7Adapter`: the numeric `useTick` delta, Pixi 7 application and destroy options, `applyProps`. Rejected: Pixi 8's `label`, Graphics `context`, `preference`, `releaseGlobalResources`, a `Ticker` tick argument and Pixi 8-only tags |
| `facade` | The baseline's documented TypeScript examples against the packed `@pixi/react` (extending built-in props, a custom `viewport` element, `extend`) |
| `must-fail/unprefixed-collision` | Unprefixed `text`/`filter` against React DOM's SVG tags |
| `must-fail/conflicting-tags` | The facade's and the modular entry's `pixiSprite` in one program |
| `must-fail/facade-override-lookup` | The facade's upstream override lookup giving a member-less custom class Text's options (kept under D4) |

Errors inside third-party declarations that a strict consumer cannot avoid are listed in `THIRD_PARTY_DEFECTS`
(package, version, codes, reason), reported, and not counted. Today that is pixi.js 8.22.0's CommonJS declarations
importing ESM-only packages under NodeNext. Any other error fails the run.

The facade cells also install `@types/react-reconciler`, because the facade's upstream `Root.fiber` declaration
imports `react-reconciler`, which ships no types. The documented custom component uses a local class with
pixi-viewport 6's public shape: pixi-viewport 6.0.3's own declarations fail a strict NodeNext consumer.

Options: `--cell <name>` (repeatable) runs some cells; `--skip-install` reuses installed cells. Installs need the
npm registry; the Turbo task passes the proxy and npm variables through.
