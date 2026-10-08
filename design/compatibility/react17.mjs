import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Reconciler from 'react-reconciler';
import React from 'react';
import { FiberProvider, useContextBridge } from 'its-fine';
const pkg = JSON.parse(readFileSync('node_modules/react-reconciler/package.json'));
const source = readFileSync('node_modules/react-reconciler/cjs/react-reconciler.development.js', 'utf8');
const hostKeys = [...new Set([...source.matchAll(/(?:\$\$\$config|\$\$\$hostConfig)\.([A-Za-z0-9_]+)/g)].map(m => m[1]))].sort();
const legacy = true;
const noop = () => {};
let priority = 0;
const append = (parent, child) => { parent.children.push(child); };
const remove = (parent, child) => { parent.children.splice(parent.children.indexOf(child), 1); };
const config = {
    now: () => performance.now(), isPrimaryRenderer: true, supportsMutation: true, supportsPersistence: false, supportsHydration: false,
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
const secondaryReconciler = Reconciler({ ...config, isPrimaryRenderer: false });
const makeRoot = (target, engine = reconciler) => engine.createContainer(target, 0, false, null);
const container = makeRoot(root);
const flush = (element, target = container, engine = reconciler) => {
    engine.flushSync(() => engine.updateContainer(element, target, null, null));
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
const secondaryRoot = makeRoot(secondary, secondaryReconciler);
for (const value of ['outer', 'changed']) {
    flush(React.createElement(Context.Provider, { value }, React.createElement(FiberProvider, null, React.createElement(Capture))));
    assert.equal(typeof Bridge, 'function');
    flush(React.createElement(Bridge, null, React.createElement(Consumer)), secondaryRoot, secondaryReconciler);
    assert.equal(secondary.children[0]?.props.value, value);
}
flush(null, secondaryRoot, secondaryReconciler);
flush(null);
// Exercise real refs, effects, state and an error boundary in the legacy root.
const ref = React.createRef();
const effects = [];
let setValue;
function Stateful() {
    const [value, set] = React.useState('initial');
    setValue = set;
    React.useLayoutEffect(() => { effects.push('layout:' + value); return () => effects.push('layout-cleanup:' + value); }, [value]);
    React.useEffect(() => { effects.push('passive:' + value); return () => effects.push('passive-cleanup:' + value); }, [value]);
    return React.createElement('stateful', { ref, value });
}
flush(React.createElement(Stateful));
reconciler.flushPassiveEffects();
assert.equal(ref.current, root.children[0]);
reconciler.flushSync(() => setValue('changed'));
reconciler.flushPassiveEffects();
assert.equal(ref.current.props.value, 'changed');
flush(null);
reconciler.flushPassiveEffects();
assert.equal(ref.current, null);
assert.deepEqual(effects, ['layout:initial', 'passive:initial', 'layout-cleanup:initial', 'layout:changed', 'passive-cleanup:initial', 'passive:changed', 'layout-cleanup:changed', 'passive-cleanup:changed']);
let caught;
class Boundary extends React.Component {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch(error) { caught = error.message; }
    render() { return this.state.failed ? React.createElement('fallback') : this.props.children; }
}
function IntentionalFailure() { throw new Error('historical-intentional-error'); }
flush(React.createElement(Boundary, null, React.createElement(IntentionalFailure)));
assert.equal(caught, 'historical-intentional-error');
assert.equal(root.children[0].type, 'fallback');
flush(null);
// its-fine reads _currentValue: a secondary source root is a separate limitation.
const secondarySource = makeRoot({ children: [] }, secondaryReconciler);
flush(React.createElement(Context.Provider, { value: 'secondary-parent' }, React.createElement(FiberProvider, null, React.createElement(Capture))), secondarySource, secondaryReconciler);
flush(React.createElement(Bridge, null, React.createElement(Consumer)), secondaryRoot, secondaryReconciler);
const secondarySourceValue = secondary.children[0]?.props.value;
assert.equal(secondarySourceValue, 'default');
flush(null, secondaryRoot, secondaryReconciler);
flush(null, secondarySource, secondaryReconciler);
const features = { secondaryParentBridge: { status: 'missing-context-value', errors: ['secondary-parent context read default'], expected: 'secondary-parent', actual: secondarySourceValue }, refs: 'attach-update-detach', effects, state: 'synchronous-update', errorBoundary: caught, contextBridge: 'mount-update-unmount', activity: 'not-available', fragmentRef: 'not-available' };
console.log(JSON.stringify({ react: React.version, scheduler: JSON.parse(readFileSync('node_modules/scheduler/package.json')).version, bridge: JSON.parse(readFileSync('node_modules/its-fine/package.json')).version, updateContainerArity: reconciler.updateContainer.length, reconciler: pkg.version, peers: pkg.peerDependencies, hostKeys, exports: Object.keys(reconciler).sort(), features, createContainerArity: reconciler.createContainer.length }));
