# Installed declaration examples

These `.d.ts` files are an ABI design sketch, not published implementations. Core and renderer have no React/Pixi imports. Pixi imports only its installed declarations; React imports only React and core. `consumer.tsx` exercises adapter-selected app/ticker/ref/event/custom-constructor types and a representative opt-in intrinsic tag. The public API's complete constructor/event/children/readonly mappings belong to issue 11; see the inventory and architecture.

Use the audit's exact TypeScript 5.6.3 compiler with this checkout's installed React/Pixi dependencies (for example install `typescript@5.6.3` under a temporary prefix and invoke its `bin/tsc` from this checkout):

```sh
/path/to/typescript-5.6.3/bin/tsc -p design/contract/tsconfig.json
/path/to/typescript-5.6.3/bin/tsc -p design/contract/tsconfig.json --module ESNext --moduleResolution Bundler
```

The program imports the declarations from the installed `react` and `pixi.js` packages. It does not replace their types with stubs or alias production code. Negative assertions reject wrong tick argument, event, ref, readonly property and missing custom constructor options. To check their sensitivity, remove one `@ts-expect-error` directive in a temporary copy: that consumer must fail at its invalid expression. These compile-time cases do not claim runtime behavior or packaging certification; downstream issues install packed packages in isolated per-epoch consumers and run real browser scenarios.

The baseline lockfile selects TypeScript 5.7.3, whose DOM PointerEvent adds altitudeAngle/azimuthAngle missing from Pixi8.2.6 declarations. These examples use audit compiler 5.6.3 with skipLibCheck disabled, rather than suppressing that external declaration mismatch. This is a compiler tuple constraint, not a reason to change production dependencies in the design ticket.
