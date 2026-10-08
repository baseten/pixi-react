import * as React from 'react';
import { FiberProvider, useContextBridge } from 'its-fine';
const Context = React.createContext('default');
const Component = React.forwardRef<{ value: string }, { label: string }>((props, ref) => {
    React.useImperativeHandle(ref, () => ({ value: props.label }));
    return null;
});
const ref = React.createRef<{ value: string }>();
const element: React.JSX.Element = <FiberProvider><Context.Provider value="outer"><Component ref={ref} label="value" /></Context.Provider></FiberProvider>;
const Bridge = () => { const B = useContextBridge(); return <B>{element}</B>; };
void Bridge;
