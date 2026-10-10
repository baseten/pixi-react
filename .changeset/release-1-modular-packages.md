---
"@pixi-react-provisional/core": minor
"@pixi-react-provisional/renderer": minor
"@pixi-react-provisional/react-19.0": minor
"@pixi-react-provisional/react-19.1": minor
"@pixi-react-provisional/react-19.2": minor
"@pixi-react-provisional/react-19.3": minor
"@pixi-react-provisional/react-18": minor
"@pixi-react-provisional/pixi-8": minor
---

Release 1 of the modular packages at 8.1.0, in lockstep with the facade (issue 62): every package releases at `@pixi/react`'s version, and the renderer and every adapter depend on core at exactly that version, so install all `@pixi/react-*` packages at the same version. The adapter ABI is 1.0, declared in the adapter manifests and checked at runtime; it is no longer encoded in core's major, so a later minor may change it, and its changelog will say so (design/release.md, version policy). Published under the names in release.packages.json (target `@pixi/react-*`, pending issue 41). Each React adapter's peer lists exactly the React versions it is tested with; the tested versions of every package are in design/release-compatibility.md.
