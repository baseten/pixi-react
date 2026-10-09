/**
 * Public features of the baseline `@pixi/react` facade. Every scenario names exactly one feature, and
 * `FEATURE-MAP.md` maps each feature to its scenarios (a unit test keeps the two in sync).
 */
export const FEATURES = {
    elements: 'Intrinsic scene elements: mount, update, reorder, removal',
    extend: '`extend` and custom constructors',
    useExtend: '`useExtend`',
    'constructor-options': 'Props passed as constructor options',
    'props.removal': 'Prop removal and default restoration',
    'props.dashed': 'Dashed (pierced) props and point props',
    events: 'Event props: add, replace, remove',
    draw: 'Graphics `draw` callback',
    text: 'Text content and style updates',
    refs: 'Refs to scene nodes',
    destruction: 'Node and container destruction',
    suspense: 'Suspense hide/unhide of scene nodes',
    'raw-text': 'Raw JSX text children',
    applyProps: '`applyProps` helper',
    'Application.init': '`<Application>` initialization: success, failure, unmount before init',
    'Application.lifecycle': '`<Application>` repeated mount/unmount and StrictMode',
    'Application.ref': '`<Application>` ref (`getApplication`, `getCanvas`)',
    'Application.resizeTo': '`<Application resizeTo>`',
    'Application.destroyOptions': '`destroyOptions` and `rendererDestroyOptions`',
    'Application.extensions': '`<Application extensions>`',
    'Application.defaultTextStyle': '`<Application defaultTextStyle>`',
    createRoot: '`createRoot` and `Root.render`',
    'multi-root': 'Several roots and applications at once',
    'context-bridge': 'Context bridging from the primary React DOM renderer',
    useApplication: '`useApplication`',
    useTick: '`useTick` and ticker cleanup',
    resources: 'Ownership of externally supplied textures and graphics contexts',
    'root.concurrency': 'Concurrent root semantics (React 18 ConcurrentRoot and later)',
    'root.errors': 'Root error routing',
} as const;

export type FeatureId = keyof typeof FEATURES;
