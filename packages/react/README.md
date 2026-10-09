<p align="center">
  <img src="./.github/react.svg" alt="pixi-react" width="310" />
</p>

<h1 align="center">
  <code>@pixi/react</code>
</h1>

<p align="center">
  <strong>Simply the best way to write PixiJS applications in React</strong>
  <br />
  <sub>Write <a href="http://www.pixijs.com/">PixiJS</a> applications using React declarative style 👌</sub>
</p>

<br />

<p align="center">
  <img src="https://img.shields.io/github/v/release/pixijs/pixi-react" alt="release" />
  <img src="https://img.shields.io/npm/dm/@pixi/react" alt="downloads" />
  <img src="https://img.shields.io/circleci/project/github/pixijs/pixi-react/master.svg" alt="ci tests" />
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="license" />
  <img src="https://img.shields.io/badge/react-v18.0.0-ff69b4.svg" alt="react version" />
</p>

<br />

`@pixi/react` is an open-source, production-ready library to render high performant PixiJS applications in React.

## Features

- React v19 support
- PixiJS v8 support

## Getting Started

### Quick Start

To start a new project, use the official PixiJS scaffolder (Vite, React 19 and `@pixi/react`):

```bash
npm create pixi.js@latest
```

and choose the `framework-react` template (or `framework-react-js` for plain JavaScript). Create React App is deprecated
and is not recommended.

#### Add to an existing app

`@pixi/react` works with any bundler-based React 19 application: Vite, Next.js, Remix and so on. Install the
dependencies:

```bash
npm install pixi.js@8.22.0 react@19.3.0 react-dom@19.3.0 @pixi/react
```

See [Supported versions](#supported-versions) for the exact React and PixiJS versions this release supports.

#### Pixi React Usage
```jsx
import {
  Application,
  extend,
} from '@pixi/react'
import {
  Container,
  Graphics,
} from 'pixi.js'
import { useCallback } from 'react'

extend({
  Container,
  Graphics,
})

const MyComponent = () => {
  const drawCallback = useCallback(graphics => {
    graphics.clear()
    graphics.setFillStyle({ color: 'red' })
    graphics.rect(0, 0, 100, 100)
    graphics.fill()
  }, [])

  return (
    <Application>
      <pixiContainer x={100} y={100}>
        <pixiGraphics draw={drawCallback} />
      </pixiContainer>
    </Application>
  )
}
```

#### No bundler?

Plain `<script>` tags are not supported, because React 19 ships no global (UMD) build. Without a bundler, load the ES
module build `dist/pixi-react.mjs` through an import map, taking React from an ESM CDN such as esm.sh and PixiJS from its
browser ESM build (`dist/pixi.mjs`):

```html
<script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@19.3.0",
      "react/": "https://esm.sh/react@19.3.0/",
      "react-dom/": "https://esm.sh/react-dom@19.3.0/",
      "pixi.js": "https://cdn.jsdelivr.net/npm/pixi.js@8.22.0/dist/pixi.mjs",
      "@pixi/react": "https://cdn.jsdelivr.net/npm/@pixi/react/dist/pixi-react.mjs"
    }
  }
</script>
<script type="module">
  import { Application, extend } from '@pixi/react'
  // ...
</script>
```

### Supported versions

`@pixi/react` is composed from modular adapters: the React 19 adapter for the newest certified React minor (19.3) and
the PixiJS 8 adapter, joined by a neutral renderer factory. The adapter code ships **bundled inside `@pixi/react`**: it
has no runtime dependency on a separate adapter package. Like upstream `@pixi/react`, which depends on
`react-reconciler`, it lists the React 19.3 adapter's own third-party code as ordinary dependencies, pinned exactly:
`react-reconciler` **0.34.0** (which brings its `scheduler`) and `its-fine` **2.1.1**. Your bundler therefore resolves
the reconciler like any other dependency, and a production build contains only its production build. The `dist/`
bundles stay self-contained, as upstream's were.

| Peer | Range |
| --- | --- |
| `react` | `^19.3.0` (certified: 19.3.0) |
| `pixi.js` | `>=8.2.6 <8.5.0 \|\| >=8.5.1 <8.23.0` (8.5.0 is excluded: its `ParticleContainer.destroy` fails) |

The React peer is a caret range so that installing next to a newer React never fails, but only React 19.3 is
certified. With another React 19 minor, `@pixi/react` runs and logs **one** console warning naming the certified
version and how to pin: pin `react` and `react-dom` to 19.3 (for example `"react": "~19.3.0"`), or, once the modular
packages are published, compose your own renderer with `createRenderer` and the React adapter package for your React
minor (see below). If you must stay on an
older React minor and do not need this release's features, upstream `@pixi/react` 8.0.5 remains available. A React outside the
19 major, or a pixi.js outside its range, is reported the first time you call into `@pixi/react` (not at import),
with a `CompatibilityError` naming the installed and expected versions.

#### Staying on an older React 19 minor

The install recipes for the modular packages are in [design/release.md](https://github.com/baseten/pixi-react/blob/main/design/release.md#installing).

`@pixi/react` always composes the newest certified React 19 epoch. The modular adapter packages (core, the renderer
factory, one React adapter package per React minor, and the PixiJS 8 adapter) are not published yet; they
will be released separately ([#15](https://github.com/baseten/pixi-react/issues/15),
[#40](https://github.com/baseten/pixi-react/issues/40)). Once they are, an application that must stay on an older
certified React 19 minor composes the same pair itself, installing the adapter package of its React minor, instead of importing
`@pixi/react` (see [the adapter architecture](https://github.com/baseten/pixi-react/blob/main/design/adapter-architecture.md#the-default-facade-ships-its-adapters-bundled)).
A composition made this way is a separate runtime with its own catalog and roots, and it gets the modular behaviour
rather than `@pixi/react`'s upstream-compatible behaviour: `extend` rejects a name clash, and `extensions` and
`defaultTextStyle` are reference-counted and restored on unmount.

Installing a modular package next to `@pixi/react` gives the application two copies of the adapter core: the one bundled
in `@pixi/react` and the separately installed one. They are distinct runtimes, each with its own reconciler: avoid
rendering both at once in one app, since only the runtimes of one copy share a reconciler. A canvas or DOM target still cannot be
owned by both at once (the ownership lease is shared through `globalThis`), but `instanceof CompatibilityError` is not
guaranteed to hold for an error thrown by the other copy: check `error.name === 'CompatibilityError'` and its `code`
instead.

## Docs

### `extend`

One of the most important concepts to understand with v8 is `extend`. Normally `@pixi/react` would have to import all pf Pixi.js to be able to provide the full library as JSX components. Instead, we use an internal catalogue of components populated by the `extend` API. This allows you to define exactly which parts of Pixi.js you want to import, keeping your bundle sizes small.

To allow `@pixi/react` to use a Pixi.js component, pass it to the `extend` API:

```jsx
import { Container } from 'pixi.js'
import { extend } from '@pixi/react'

extend({ Container })

const MyComponent = () => (
  <pixiContainer />
)
```

> [!CAUTION]
> Attempting to use components that haven't been passed to the `extend` API **will result in errors**.

### Components

#### `<Application>`

The `<Application>` component is used to wrap your `@pixi/react` app. The `<Application>` component can take [all props that can be set](https://pixijs.download/release/docs/app.ApplicationOptions.html) on [`PIXI.Application`](https://pixijs.download/release/docs/app.Application.html).

##### Example Usage

```jsx
import { Application } from '@pixi/react'

const MyComponent = () => {
  return (
    <Application
      autoStart
      sharedTicker />
  )
}
```

###### `defaultTextStyle`

`defaultTextStyle` is a convenience property. Whatever is passed will automatically be assigned to Pixi.js's [`TextStyle.defaultTextStyle`](https://pixijs.download/release/docs/text.TextStyle.html#defaultTextStyle).

> [!NOTE]
> This property **is not retroactive**. It will only apply to text components created after `defaultTextStyle` is set. Any text components created before setting `defaultTextStyle` will retain the base styles they had before `defaultTextStyle` was changed.

###### `destroyOptions`

When an `<Application>` is unmounted, it will call the `destroy()` method on the Pixi.js application instance. Provide this prop to override the default `DestroyOptions` (the second argument to `destroy()`). See Pixi.js's [`destroy documentation`](https://pixijs.download/release/docs/app.Application.html#destroy) for more info.

###### `extensions`

`extensions` is an array of extensions to be loaded. Adding and removing items from this array will automatically load/unload the extensions. The first time this is handled happens before the application is initialised. See Pixi.js's [`extensions`](https://pixijs.download/release/docs/extensions.html) documentation for more info on extensions.

###### `rendererDestroyOptions`

When an `<Application>` is unmounted, it will call the `destroy()` method on the Pixi.js application instance. Provide this prop to override the default `RendererDestroyOptions` (the first argument to `destroy()`). See Pixi.js's [`destroy documentation`](https://pixijs.download/release/docs/app.Application.html#destroy) for more info.

###### `resizeTo`

The `<Application>` component supports the `resizeTo` property, with some additional functionality: it can accept any HTML element **or** it can take a React `ref` directly.

```jsx
import { Application } from '@pixi/react'
import { useRef } from 'react'
const MyComponent = () => {
  const parentRef = useRef(null)
  return (
    <div ref={parentRef}>
      <Application resizeTo={parentRef} />
    </div>
  )
}
```

#### Pixi Components

All other components should be included in your IDE's intellisense/autocomplete once you've installed/imported `@pixi/react`. If it's exported from Pixi.js, it's supported as a component with the `pixi` prefix. Here's a selection of commonly used components:

```jsx
<pixiContainer />
<pixiGraphics />
<pixiSprite />
<pixiAnimatedSprite />
<pixiText />
<pixiHtmlText />
```

##### `<pixiGraphics>`

The `pixiGraphics` component has a special `draw` property. `draw` takes a callback which receives the `Graphics` context, allowing drawing to happen on every tick.

```jsx
const MyComponent = () => {
  return (
    <pixiGraphics draw={graphics => {
      graphics.clear()
      graphics.setFillStyle({ color: 'red' })
      graphics.rect(0, 0, 100, 100)
      graphics.fill()
    }} />
  )
}
```

#### Custom Components

`@pixi/react` supports custom components via the `extend` API. For example, you can create a `<viewport>` component using the [`pixi-viewport`](https://github.com/davidfig/pixi-viewport) library:

```jsx
import { extend } from '@pixi/react'
import { Viewport } from 'pixi-viewport'

extend({ Viewport })

const MyComponent = () => {
  <viewport>
    <pixiContainer />
  </viewport>
}
```

The `extend` API will teach `@pixi/react` about your components, but TypeScript won't know about them nor their props. If you're using Typescript, check out our [docs for Typescript Users](#for-typescript-users).

### Hooks

#### `useApplication`

`useApplication` allows access to the parent `PIXI.Application` created by the `<Application>` component. This hook _will not work_ outside of an `<Application>` component. Additionally, the parent application is passed via [React Context](https://react.dev/reference/react/useContext). This means `useApplication` will only work appropriately in _child components_, and in the same component that creates the `<Application>`.

For example, the following example `useApplication` **will not** be able to access the parent application:

```jsx
import {
  Application,
  useApplication,
} from '@pixi/react'

const ParentComponent = () => {
  // This will cause an invariant violation.
  const { app } = useApplication()

  return (
    <Application />
  )
}
```

Here's a working example where `useApplication` **will** be able to access the parent application:

```jsx
import {
  Application,
  useApplication,
} from '@pixi/react'

const ChildComponent = () => {
  const { app } = useApplication()

  console.log(app)

  return (
    <container />
  )
}

const ParentComponent = () => (
  <Application>
    <ChildComponent />
  </Application>
)
```

#### `useExtend`

`useExtend` allows the `extend` API to be used as a React hook. Additionally, the `useExtend` hook is memoised, while the `extend` function is not.

```jsx
import { Container } from 'pixi.js'
import { useExtend } from '@pixi/react'

const MyComponent = () => {
  useExtend({ Container })

  return (
    <container />
  )
}
```

#### `useTick`

`useTick` allows a callback to be attached to the [`Ticker`](https://pixijs.download/release/docs/ticker.Ticker.html) on the parent application.

```jsx
import { useTick } from '@pixi/react'

const MyComponent = () => {
  useTick(() => console.log('This will be logged on every tick'))
}
```

`useTick` optionally takes an options object. This allows control of all [`ticker.add`](https://pixijs.download/release/docs/ticker.Ticker.html#add) options, as well as adding the `isEnabled` option. Setting `isEnabled` to `false` will cause the callback to be disabled until the argument is changed to true again.

```jsx
import { useState } from 'react'
import { useTick } from '@pixi/react'

const MyComponent = () => {
  const [isEnabled, setIsEnabled] = useState(false)

  useTick(() => console.log('This will be logged on every tick as long as `isEnabled` is `true`'), isEnabled)

  return (
    <sprite onClick={setIsEnabled(previousState => !previousState)}>
  )
}
```

> [!CAUTION]
> The callback passed to `useTick` **is not memoised**. This can cause issues where your callback is being removed and added back to the ticker on every frame if you're mutating state in a component where `useTick` is using a non-memoised function. For example, this issue would affect the component below because we are mutating the state, causing the component to re-render constantly:
> ```jsx
> import { useState } from 'react'
> import { useTick } from '@pixi/react'
>
> const MyComponent = () => {
>   const [count, setCount] = useState(0)
>
>   useTick(() => setCount(previousCount => previousCount + 1))
>
>   return null
> }
> ```
> This issue can be solved by memoising the callback passed to `useTick`:
> ```jsx
> import {
>   useCallback,
>   useState,
> } from 'react'
> import { useTick } from '@pixi/react'
>
> const MyComponent = () => {
>   const [count, setCount] = useState(0)
>
>   const updateCount = useCallback(() => setCount(previousCount => previousCount + 1), [])
>
>   useTick(updateCount)
> }
> ```

### For Typescript Users

#### Custom Components

`@pixi/react` already offers types for built-in components, but custom components need to be added to the library's type catalogue so it knows how to handle them. This can be achieved by adding your custom components to the `PixiElements` interface. Here's what it may look like to add the `viewport` component from our earlier `extend` example:

```ts
// global.d.ts
import { type PixiReactElementProps } from '@pixi/react'
import { type Viewport } from 'pixi-viewport'

declare module '@pixi/react' {
  interface PixiElements {
    viewport: PixiReactElementProps<typeof Viewport>;
  }
}
```

Now you'll be able to use your custom component in your project without any type errors!

#### Unprefixed Elements

If you like to live life on the wild side, you can enable unprefixed Pixi elements (i.e. `<container>` instead of `<pixiContainer>`) by adding the `UnprefixedPixiElements` interface to the `PixiElements` interface.

```ts
// global.d.ts
import { type UnprefixedPixiElements } from '@pixi/react'

declare module '@pixi/react' {
  interface PixiElements extends UnprefixedPixiElements {}
}
```

The prefixed and unprefixed elements have the same functionality, but we recommend sticking to the prefixed components to avoid collisions with other libraries that add intrinsic elements to JSX (such as [`react-dom`](https://www.npmjs.com/package/react-dom) and [`@react-three/fiber`](https://www.npmjs.com/package/@react-three/fiber)).

> [!IMPORTANT]
> Some components conflict with other libaries, such as `<svg>` in `react-dom` and `<color>` in `@react-three/fiber`. To address this the `pixi` prefixed elements are always available, even after injecting the unprefixed elements.


#### Extending Built-in Components

The props for built-in components are available on the `PixiElements` type and can be used to extend the built-in types.

```ts
import { type PixiElements } from '@pixi/react'

export type TilingSpriteProps = PixiElements['pixiTilingSprite'] & {
  image?: string;
  texture?: Texture;
};
```
