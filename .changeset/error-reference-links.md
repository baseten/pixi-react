---
"@pixi/react": patch
"@pixi-react-provisional/core": minor
"@pixi-react-provisional/react-19.0": patch
"@pixi-react-provisional/react-19.1": patch
"@pixi-react-provisional/react-19.2": patch
"@pixi-react-provisional/react-19.3": patch
"@pixi-react-provisional/react-18.0": patch
"@pixi-react-provisional/react-18.1": patch
"@pixi-react-provisional/react-18.2": patch
"@pixi-react-provisional/react-18.3": patch
---

Link every `CompatibilityError` to its docs page (issue 71). In development and production builds alike, the message of each built-in code (`ABI_MISMATCH`, `CAPABILITY_MISSING`, `UNSUPPORTED_TUPLE`, `UNKNOWN_ELEMENT`, `UNSUPPORTED_NODE`, `REGISTRY_CONFLICT`, `ROOT_DISPOSED`, `INIT_FAILED`) and of core's `core.` codes now ends with ` See https://baseten.github.io/pixi-react/errors/<code>/`, the code's page in the new error reference (what it means, common causes, the exact fix), and `error.docsUrl` holds that URL. `core.` codes use `-` for `.` in the address (`errors/core-TARGET_LEASED/`). An adapter-namespaced code gets a link only when the adapter passes the new optional `docsUrl` detail; the React adapters do so for `react-18.FOREIGN_RUNTIME` and `react-19.FOREIGN_RUNTIME`. Core exports `ERROR_DOCS_URL` and `errorDocsUrl(code)`. Code that compares a `CompatibilityError` message exactly must expect the added link; match on `code` instead.
