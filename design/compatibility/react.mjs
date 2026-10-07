import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Reconciler from 'react-reconciler';
import React from 'react';
import { FiberProvider, useContextBridge } from 'its-fine';
const pkg = JSON.parse(readFileSync('node_modules/react-reconciler/package.json'));
const source = readFileSync('node_modules/react-reconciler/cjs/react-reconciler.development.js', 'utf8');
const hostKeys = [...new Set([...source.matchAll(/(?:\$\$\$config|\$\$\$hostConfig)\.([A-Za-z0-9_]+)/g)].map(m => m[1]))].sort();
const legacy = React.version.startsWith('18.');
const noop = () => {};
let priority = 0;
const append = (parent, child) => { parent.children.push(child); };
const remove = (parent, child) => { parent.children.splice(parent.children.indexOf(child), 1); };
const config = {
    isPrimaryRenderer: false, supportsMutation: true, supportsPersistence: false, supportsHydration: false,
    noTimeout: -1, NotPendingTransition: null, getRootHostContext: () => ({}), getChildHostContext: () => ({}),
    getPublicInstance: x => x, prepareForCommit: () => null, resetAfterCommit: noop, shouldSetTextContent: () => false,
    createInstance: (type, props) => ({ type, props, children: [] }), createTextInstance: text => ({ text }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, clearContainer: p => { p.children = []; },
    finalizeInitialChildren: () => false, prepareUpdate: () => true,
    commitUpdate: (...args) => { args[0].props = args[legacy ? 4 : 3]; }, commitTextUpdate: (node, old, text) => { node.text = text; },
    hideInstance: node => { node.hidden = true; }, unhideInstance: node => { node.hidden = false; },
    hideTextInstance: noop, unhideTextInstance: noop, detachDeletedInstance: noop,
    scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
    getCurrentEventPriority: () => 16, getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: p => { priority = p; }, resolveUpdatePriority: () => priority || 32,
    maySuspendCommit: () => false, preloadInstance: () => true, startSuspendingCommit: noop, suspendInstance: noop, waitForCommitToBeReady: () => null,
    shouldAttemptEagerTransition: () => false, requestPostPaintCallback: noop, resetFormInstance: noop,
    trackSchedulerEvent: noop, resolveEventType: () => null, resolveEventTimeStamp: () => -1,
};
const reconciler = Reconciler(config);
const root = { children: [] };
const errors = [];
const onError = e => errors.push(String(e));
const makeRoot = target => legacy ? reconciler.createContainer(target, 0, null, false, null, '', onError, null) : reconciler.createContainer(target, 1, null, false, null, '', onError, onError, onError, ...(Number(React.version.split('.')[1]) >= 2 ? [noop, null] : [null]));
const container = makeRoot(root);
const flush = (element, target = container) => {
    if (legacy) reconciler.flushSync(() => reconciler.updateContainer(element, target, null, null));
    else { reconciler.updateContainerSync(element, target, null, null); reconciler.flushSyncWork(); }
};
flush(React.createElement('node', { label: 'first' }));
assert.equal(root.children[0]?.props.label, 'first');
flush(React.createElement('node', { label: 'updated' }));
assert.equal(root.children[0]?.props.label, 'updated');
flush(null);
assert.equal(root.children.length, 0);
assert.deepEqual(errors, []);
const Context = React.createContext('default');
let Bridge;
function Capture() { Bridge = useContextBridge(); return null; }
function Consumer() { return React.createElement('context', { value: React.useContext(Context) }); }
const secondary = { children: [] };
const secondaryRoot = makeRoot(secondary);
for (const value of ['outer', 'changed']) {
    flush(React.createElement(Context.Provider, { value }, React.createElement(FiberProvider, null, React.createElement(Capture))));
    assert.equal(typeof Bridge, 'function');
    flush(React.createElement(Bridge, null, React.createElement(Consumer)), secondaryRoot);
    assert.equal(secondary.children[0]?.props.value, value);
}
flush(null, secondaryRoot);
flush(null);
const features = { contextBridge: 'mount-update-unmount', activity: 'not-available', fragmentRef: 'not-available' };
if (React.Activity) {
    flush(React.createElement(React.Activity, { mode: 'visible' }, React.createElement('node')));
    flush(React.createElement(React.Activity, { mode: 'hidden' }, React.createElement('node')));
    assert.equal(root.children[0]?.hidden, true);
    flush(React.createElement(React.Activity, { mode: 'visible' }, React.createElement('node')));
    assert.equal(root.children[0]?.hidden, false);
    features.activity = 'hide-restore';
    flush(null);
}
// Error callbacks are real root arguments; only the intentional error may arrive.
function Broken() { throw new Error('audit-intentional-error'); }
if (!legacy) {
    flush(React.createElement(Broken));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /audit-intentional-error/);
    errors.length = 0;
}

if (!legacy && Number(React.version.split('.')[1]) >= 3) {
    flush(React.createElement(React.Fragment, { ref: React.createRef() }, React.createElement('node')));
    features.fragmentRef = errors.length ? { status: 'missing-host-capability', errors: [...errors] } : 'rendered';
    assert.equal(errors.length, 1);
    assert.match(errors[0], /createFragmentInstance/);
    errors.length = 0;
    flush(null);
}
console.log(JSON.stringify({ react: React.version, reconciler: pkg.version, peers: pkg.peerDependencies, hostKeys, exports: Object.keys(reconciler).sort(), features, createContainerArity: reconciler.createContainer.length }));
