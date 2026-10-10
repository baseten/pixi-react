---
"@pixi/react": patch
"@pixi-react-provisional/core": patch
"@pixi-react-provisional/renderer": patch
"@pixi-react-provisional/react-19.0": patch
"@pixi-react-provisional/react-19.1": patch
"@pixi-react-provisional/react-19.2": patch
"@pixi-react-provisional/react-19.3": patch
"@pixi-react-provisional/react-18.3": patch
"@pixi-react-provisional/pixi-8": patch
---

Smaller production bundles (issue 58). The same checks run, and throw the same errors, in every build; only development-only text is dropped from production builds:

- Diagnostic message text is built behind `process.env.NODE_ENV !== 'production'`, which the published JavaScript leaves as written for the application's bundler to replace. In a production build a `CompatibilityError` keeps its class, code and details (`adapterIds`, `capability`, `expected`, `actual`, `cause`), and its message is built from them, for example `ABI_MISMATCH (pixi-8; expected {"major":1}; actual {"major":2,"minor":0}). A development build (NODE_ENV !== 'production') gives the full message.` `UNKNOWN_ELEMENT` keeps its full message. A few `TypeError`s for invalid arguments have shorter production messages too.
- The Pixi 8 adapter's console warnings (Pixi-named event props, `draw` on a node that is not a Graphics, a dashed prop naming a missing field, a removed prop with no default) are development-only; the behaviour they describe is unchanged.
- `new CompatibilityError('', details)` builds its message from the details; a non-empty message is kept as given.
- core, renderer and pixi-8 ship each runtime entry as one bundled CommonJS file instead of one file per module (the package exports and declarations are unchanged), and `@pixi/react` bundles its adapters from their sources into `lib/adapters.js`, still one module (D6). The React adapters no longer bundle their test-only host-key audit tables.

The release fixture's production bundle (esbuild, minified, pixi.js 8.22.0, React 19.3.0): `@pixi/react` 751.7 KiB to 732.2 KiB (222.9 to 217.2 KiB gzip); our own code in it 83.9 to 64.4 KiB.
