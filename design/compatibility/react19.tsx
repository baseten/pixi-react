import * as React from 'react';
const Component = (props: { ref?: React.Ref<{ value: number }> }) => null;
const element: React.JSX.Element = <Component ref={instance => { void instance; return () => {}; }} />;
void element;
