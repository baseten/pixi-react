import { type ExpectedFailure } from '@pixi-react-provisional/conformance';

const issue = (number: number) => `https://github.com/baseten/pixi-react/issues/${number}`;

/**
 * Confirmed defects of the baseline facade, found by the conformance scenarios. Each entry fails today with
 * an error matching `match`; when a fix lands the run fails until the entry is removed. The library source
 * is unchanged by issue 6: each `owner` is the extraction ticket that owns the bounded fix. Whether a fix
 * also ships in the default facade is a D4 (strict upstream parity) decision for issue 10.
 */
export const expectedFailures: Readonly<Record<string, ExpectedFailure>> = {
    'destruction.nested': {
        reason: 'removeChild calls destroy() without { children: true }, so descendants of a removed node are never destroyed',
        match: /destroy count per node/,
        owner: issue(8),
    },
    'destruction.app-unmount-nested': {
        reason: 'React removes top-level nodes with destroy() before app.destroy runs, so nested nodes are never destroyed',
        match: /destroy count per node/,
        owner: issue(8),
    },
    'suspense.unhide-keeps-user-visibility': {
        reason: 'unhideInstance sets visible = true unconditionally, overriding a committed visible={false}',
        match: /user visibility after unhide/,
        owner: issue(8),
    },
    'props.removal.required-constructor-argument': {
        reason: 'prop removal builds a default instance with new Ctor(), which throws for classes that need arguments',
        match: /errors during prop removal: expected 'ConformanceCustom requires/,
        owner: issue(8),
    },
    'props.dashed.mount': {
        reason: 'createInstance passes "position-x" to the constructor, which stores it as an own property; the mount diff then sees no change and never sets position.x',
        match: /position\.x: expected \+0 to be 10/,
        owner: issue(8),
    },
    'resources.destroy-options-transfer': {
        reason: 'children are removed and destroyed without options before app.destroy(…, destroyOptions), so texture: true never reaches them',
        match: /texture destroyed: expected false to be true/,
        owner: issue(8),
    },
    'Application.extensions.swap': {
        reason: 'the extensions effect calls splice(-1, 1) for a removed extension, dropping the last new extension instead of adding it',
        match: /second extension active: expected false to be true/,
        owner: issue(8),
    },
    'Application.init.failure-no-unhandled-rejection': {
        reason: 'Application calls root.render() without handling its promise, so an init rejection is unhandled',
        match: /unhandled rejections: expected \[ 'Error: conformance: init failure' \]/,
        owner: issue(9),
    },
    'Application.init.failure-unmount': {
        reason: 'a root that never initialised is parked in the global unmount queue on unmount and is not released',
        match: /roots after unmount: expected 1 to be \+0/,
        owner: issue(9),
    },
    'Application.init.failure-isolated': {
        reason: 'the parked failed root is destroyed during the next Application\'s init and throws from Pixi\'s ResizePlugin',
        match: /errors while mounting the next Application: expected '.*_cancelResize is not a function/,
        owner: issue(9),
    },
    'Application.init.unmount-before-init.no-late-commit': {
        reason: 'after init settles, the queued unmount (render null) and the children update land in one commit: the children are committed, then app.destroy runs without destroying them',
        match: /late nodes left alive: expected \[ 'late' \]/,
        owner: issue(9),
    },
    'Application.init.unmount-before-init.no-oninit': {
        reason: 'handleInit processes the unmount queue and then still calls onInit for the unmounted Application',
        match: /onInit calls after unmount: expected 1 to be \+0/,
        owner: issue(9),
    },
    'Application.lifecycle.strict-mode-children-after-init': {
        reason: 'the StrictMode effect replay calls root.render() again while init is pending; that call skips init and commits children immediately',
        match: /first construction after init settled/,
        owner: issue(9),
    },
    'createRoot.render-resolves-after-commit': {
        reason: 'Root.render resolves right after scheduling updateContainer, before the commit',
        match: /stage children when render resolved: expected \[\] to deeply equal \[ 'x' \]/,
        owner: issue(9),
    },
    'createRoot.unmount': {
        reason: 'the facade Root has no unmount(); a createRoot root can only be torn down through `<Application>`',
        match: /root\.unmount: expected 'undefined' to be 'function'/,
        owner: issue(9),
    },
    'createRoot.same-element': {
        reason: 'roots are keyed by the created canvas, so a second createRoot on the same element creates a second root and app',
        match: /second root: expected .* to be/,
        owner: issue(7),
    },
};
