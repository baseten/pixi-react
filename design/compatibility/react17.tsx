import React, { createContext, createRef, forwardRef, useContext, useImperativeHandle } from 'react';
import Reconciler from 'react-reconciler';
import { FiberProvider, useContextBridge } from 'its-fine';
const Context = createContext('default');
const Example = forwardRef<{ value: string }, { label: string }>((props, ref) => {
    const value = useContext(Context);
    useImperativeHandle(ref, () => ({ value }), [value]);
    return <span>{props.label}</span>;
});
function Bridged(): React.ReactElement {
    const Bridge = useContextBridge();
    return <Bridge><Example label="legacy" ref={createRef<{ value: string }>()} /></Bridge>;
}
export const tree = <Context.Provider value="outer"><FiberProvider><Bridged /></FiberProvider></Context.Provider>;
declare const reconciler: Reconciler.Reconciler<object, object, object, object, object>;
const root = reconciler.createContainer({}, 0, false, null);
reconciler.updateContainer(tree, root, null, () => {});
reconciler.flushSync(() => reconciler.updateContainer(null, root, null, null));
// @ts-expect-error React17 has no use API
React.use(Promise.resolve('value'));
// @ts-expect-error modern root error-callback signature is not the React17 root API
reconciler.createContainer({}, 0, null, false, null, '', () => {}, null);
