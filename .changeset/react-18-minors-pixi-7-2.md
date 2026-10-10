---
"@pixi-react-provisional/react-18.0": minor
"@pixi-react-provisional/react-18.1": minor
"@pixi-react-provisional/react-18.2": minor
"@pixi-react-provisional/react-18.3": minor
"@pixi-react-provisional/pixi-7": minor
---

React 18 is one package per minor, like React 19: `react-18.0` (react-reconciler 0.27.0, React peer `18.0.0`), `react-18.1` (0.28.0, `18.1.0`), `react-18.2` (0.29.0, `18.2.0`) and `react-18.3` (0.29.2, `18.3.1`), each exporting `React18Adapter` (also as `React180Adapter` … `React183Adapter`). The unreleased `react-18` package is renamed `react-18.3`, as issue 49 named the React 19 minors. Each package's peer lists exactly its tested React, and `checkEnvironment()` rejects another React minor with `UNSUPPORTED_TUPLE`, naming the package to install. The Pixi 7 adapter's peer widens to `>=7.2.0 <7.4.0 || >=7.4.2 <7.5.0`: pixi.js 7.2.0, 7.2.4, 7.3.0 and 7.3.3 are tested beside 7.4.2 and 7.4.3; 7.4.0 stays excluded (its module scope needs the browser `Worker`). Adapter ABI 1.0, unchanged.
