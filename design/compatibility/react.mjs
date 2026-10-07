import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Reconciler from 'react-reconciler';
import React from 'react';
const pkg = JSON.parse(readFileSync('node_modules/react-reconciler/package.json'));
const source = readFileSync('node_modules/react-reconciler/cjs/react-reconciler.development.js', 'utf8');
const hostKeys = [...new Set([...source.matchAll(/\$\$\$config\.([A-Za-z0-9_]+)/g)].map(m => m[1]))].sort();
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
const container = legacy ? reconciler.createContainer(root, 0, null, false, null, '', onError, null) : reconciler.createContainer(root, 1, null, false, null, '', onError, onError, onError, null);
const flush = element => {
    if (legacy) reconciler.flushSync(() => reconciler.updateContainer(element, container, null, null));
    else { reconciler.updateContainerSync(element, container, null, null); reconciler.flushSyncWork(); }
};
flush(React.createElement('node', { label: 'first' }));
assert.equal(root.children[0]?.props.label, 'first');
flush(React.createElement('node', { label: 'updated' }));
assert.equal(root.children[0]?.props.label, 'updated');
flush(null);
assert.equal(root.children.length, 0);
assert.deepEqual(errors, []);
console.log(JSON.stringify({ react: React.version, reconciler: pkg.version, peers: pkg.peerDependencies, hostKeys, exports: Object.keys(reconciler).sort(), createContainerArity: reconciler.createContainer.length }));
