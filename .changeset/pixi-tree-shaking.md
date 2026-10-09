---
"@pixi/react": patch
"@pixi-react-provisional/pixi-8": patch
---

Restore Pixi tree shaking (issue 57): the entry points import only the pixi.js exports the Pixi 8 adapter uses, by name, instead of binding the whole `pixi.js` namespace, so application bundles keep only the Pixi classes they import, as upstream 8.0.5's did. The adapter recognizes the built-ins it treats specially from the constructors an application registers, and reads optional features from the installed `VERSION`.
