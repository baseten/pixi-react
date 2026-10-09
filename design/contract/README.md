# Installed declaration examples

These `.d.ts` files are an ABI design sketch, not published implementations. Core and renderer have no React/Pixi imports. Pixi imports only its installed declarations; React imports only React and core. `consumer.tsx` exercises adapter-selected app/ticker/ref/event/custom-constructor types and a representative opt-in intrinsic tag. `elements.tsx` probes the constructor-to-props mapping ported from upstream `ConstructorOverrides`/`ConstructorOptions`/`OmitKeys`/`PixiReactElementProps` (Text, BitmapText, HTMLText, TilingSprite, BlurFilter, AnimatedSprite, a custom no-argument Container subclass and nested Container children). `errors.ts` exercises the shared error class, diagnostics, narrowing and third-party codes. The public API's complete constructor/event/children/readonly mappings belong to issue 11; see the inventory and architecture.

Run the audit's exact TypeScript 5.6.3 compiler against this checkout's installed React/Pixi dependencies under both NodeNext and Bundler resolution:

```sh
npm run test:contract
```

The script is equivalent to:

```sh
npx -y -p typescript@5.6.3 tsc -p design/contract/tsconfig.json
npx -y -p typescript@5.6.3 tsc -p design/contract/tsconfig.json --module ESNext --moduleResolution Bundler
```

The program imports the declarations from the installed `react` and `pixi.js` packages. It does not replace their types with stubs or alias production code. Negative assertions reject wrong tick argument, event, ref, readonly property, missing custom constructor options, wrong override-table option types, missing required AnimatedSprite textures and lowercase Pixi event options, plus malformed error codes/IDs/diagnostics and access to an unnarrowed cause. To check their sensitivity, remove one `@ts-expect-error` directive in a temporary copy: that program must fail at its invalid expression. Every directive must pass this check. These compile-time cases do not claim runtime behavior or packaging certification; downstream issues install packed packages in isolated per-epoch consumers and run real browser scenarios.

The baseline lockfile selects TypeScript 5.7.3, whose DOM PointerEvent adds altitudeAngle/azimuthAngle missing from Pixi8.2.6 declarations. These examples use audit compiler 5.6.3 with skipLibCheck disabled, rather than suppressing that external declaration mismatch. This is a compiler tuple constraint, not a reason to change production dependencies in the design ticket.
