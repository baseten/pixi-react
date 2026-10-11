---
"@pixi/react": patch
"@pixi-react-provisional/react-19.0": patch
"@pixi-react-provisional/react-19.1": patch
"@pixi-react-provisional/react-19.2": patch
"@pixi-react-provisional/react-19.3": patch
---

Select the `<Activity>` bridge by feature, not by adapter minor. The React 19.2 and 19.3 adapters forwarded the parent tree's `<Activity>` visibility with its-fine's `useActivityBridge` unconditionally, and that hook throws "its-fine: useActivityBridge requires React 19.2 or later!" when `React.Activity` is missing. The per-minor packages already reject another React minor in `checkEnvironment`, so this was not reachable through a supported setup; the adapters now use the bridge only when the installed React exports `Activity` and otherwise render the scene root's children through a pass-through, as the 19.0 and 19.1 adapters do. Behaviour on React 19.2 and 19.3 is unchanged.
