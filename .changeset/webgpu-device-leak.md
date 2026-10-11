---
"@pixi/react": patch
"@pixi-react-provisional/pixi-8": patch
---

Destroy the WebGPU device on teardown. pixi.js 8.2.6 to 8.20.x never destroys the `GPUDevice` its WebGPU renderer created ([pixijs/pixijs#12173](https://github.com/pixijs/pixijs/pull/12173), fixed in 8.21.0), so every `<Application>` that mounted and unmounted on WebGPU leaked one; on Direct3D 12 (Chrome on Windows) `requestDevice` eventually failed with `E_OUTOFMEMORY` and later applications could not initialize. The Pixi 8 adapter now destroys that device after `Application.destroy` (and after destroying a renderer whose initialization failed) on pixi.js before 8.21. A device the application supplied through the `gpu` option is never destroyed; on pixi.js 8.21 and later Pixi destroys its own device and the adapter does nothing.
