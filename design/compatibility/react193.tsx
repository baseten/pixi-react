import * as React from 'react';
const ref = React.createRef<React.FragmentInstance>();
const element = <React.ViewTransition><React.Fragment ref={ref}><div /></React.Fragment></React.ViewTransition>;
void element;
